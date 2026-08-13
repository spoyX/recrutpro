import { Router } from 'express';
import {
  register,
  list,
  changeStage,
  putResume,
  getResume,
  detail,
} from '../controllers/candidate.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { uploadResume } from '../middleware/upload.middleware';
import { Role } from '../common/constants';

const router = Router();

// Every route needs a session (rule 1).
router.use(requireAuth);

/**
 * @openapi
 * /candidates/{id}/resume:
 *   get:
 *     summary: Télécharge le CV actif d'un candidat (FR-23, FR-35)
 *     description: >
 *       D-040 : le fichier transite PAR le backend (proxy), sans redirection
 *       vers une URL de stockage. Les CV sont stockés en mode « authenticated » :
 *       aucune URL publique n'existe, donc le contrôle d'accès de cette route
 *       est le seul chemin vers un CV.
 *       D-047 : le Responsable hiérarchique y accède UNIQUEMENT pour un
 *       candidat dont il mène l'entretien, et dans son propre département —
 *       le même prédicat que sa liste FR-35. Le Recruteur y accède sans
 *       restriction.
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Le fichier CV.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       403: { description: Responsable non assigné à ce candidat (D-047)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Candidat inexistant ou aucun CV téléversé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
// D-068 adds the Administrateur, READ-ONLY. The CV is part of the candidate
// file they were granted, and the D-067 payload advertises a `resume.url` —
// leaving this route closed would ship a download link that 403s. Uploading
// and replacing a CV stay Recruteur-only, below the write guard.
router.get(
  '/:id/resume',
  requireRole(Role.Recruteur, Role.ResponsableHierarchique, Role.Administrateur),
  getResume,
);

/**
 * @openapi
 * /candidates/{id}:
 *   get:
 *     summary: Dossier complet d'un candidat (D-067) — page Détail candidat
 *     description: >
 *       Renvoie le dossier entier en UNE requête : le candidat, son poste, la
 *       personne qui l'a enregistré, la présence d'un CV, l'historique de ses
 *       entretiens (du plus récent au plus ancien) et, pour chaque entretien,
 *       son évaluation. Aucune de ces trois dernières informations n'est
 *       accessible par un autre endpoint : il n'existe pas de route de
 *       métadonnées de CV, `GET /interviews` ne filtre pas par candidat, et
 *       aucune route ne renvoie une évaluation.
 *       Accès : Recruteur sans restriction ; Responsable hiérarchique
 *       UNIQUEMENT pour un candidat dont il mène l'entretien et dans son
 *       département (D-047, même prédicat que la liste FR-35). Pour ce rôle,
 *       `email` et `phone` sont renvoyés à `null` : FR-35 lui accorde le nom,
 *       le poste et le CV, pas les coordonnées.
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Le dossier du candidat. }
 *       403: { description: Responsable non assigné à ce candidat, ou rôle non autorisé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Candidat inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
// D-068 adds the Administrateur, READ-ONLY, on D-038's oversight rationale.
// Note what is NOT granted with it: `GET /candidates` (the FR-24 list) sits
// below the Recruteur-only guard and stays there. Reading one candidate's file
// while auditing is a different act from pulling every candidate's contact
// details in bulk, and only the first was asked for.
router.get(
  '/:id',
  requireRole(Role.Recruteur, Role.ResponsableHierarchique, Role.Administrateur),
  detail,
);

// D-051: the stage transition serves BOTH roles — CV review for a Recruteur
// (FR-25/FR-26), the final decision for a Responsable (FR-29/FR-39) — so it
// must sit above the Recruteur-only router.use below. The service decides
// which transitions each role may perform. Documented further down the file.
router.patch('/:id/stage', requireRole(Role.Recruteur, Role.ResponsableHierarchique), changeStage);

// SRS.md heads this module "Gestion des candidats (Recruteur, sauf précision)",
// and FR-19 reads "Le recruteur peut enregistrer". Everything BELOW this line
// is Recruteur-only, router-wide, so rule 1 holds for any route added later.
// FR-35's CV read above is the one "sauf précision" granted so far; the rest
// arrive with FR-28/FR-29.
router.use(requireRole(Role.Recruteur));

/**
 * @openapi
 * /candidates:
 *   post:
 *     summary: Enregistre un candidat (FR-19) — Recruteur uniquement
 *     description: >
 *       L'étape initiale est fixée automatiquement à « Candidature reçue » et
 *       ne peut pas être fournie par le client (D-006). Le poste doit exister
 *       et ne pas être clôturé (FR-16).
 *       FR-20 : si un candidat portant la même adresse email existe déjà sur ce
 *       poste, la requête est refusée avec un avertissement détaillé ; la
 *       renvoyer avec `confirmDuplicate: true` crée le doublon volontairement.
 *     tags: [Candidates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phone, jobPositionId]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               jobPositionId: { type: string }
 *               confirmDuplicate:
 *                 type: boolean
 *                 description: FR-20 — confirme la création malgré un doublon détecté.
 *     responses:
 *       201: { description: Candidat enregistré à l'étape « Candidature reçue ». }
 *       400: { description: Champ manquant ou email invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Poste inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Poste clôturé (FR-16) ou doublon non confirmé (FR-20)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', register);

/**
 * @openapi
 * /candidates:
 *   get:
 *     summary: Liste les candidats (FR-24) — Recruteur uniquement
 *     description: >
 *       Filtrable par poste, étape du pipeline et plage de dates
 *       d'enregistrement, avec pagination et tri.
 *       Le nombre total de candidats correspondant au filtre (avant
 *       pagination) est renvoyé dans l'en-tête `X-Total-Count`.
 *       Une valeur de filtre inconnue est refusée avec un 400 — jamais ignorée
 *       silencieusement, ce qui renverrait une liste faussement vide.
 *       `toDate` au format AAAA-MM-JJ couvre la journée entière.
 *     tags: [Candidates]
 *     parameters:
 *       - in: query
 *         name: jobPositionId
 *         schema: { type: string }
 *       - in: query
 *         name: currentStage
 *         schema:
 *           type: string
 *           enum: [Candidature reçue, Présélection CV validée, Rejeté (CV), Entretien planifié, Évaluation complétée, Accepté, Rejeté]
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [fullName, currentStage, registeredAt], default: registeredAt }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Liste des candidats correspondant au filtre.
 *         headers:
 *           X-Total-Count:
 *             description: Nombre total de candidats correspondant au filtre, avant pagination.
 *             schema: { type: integer }
 *       400: { description: Filtre, tri ou pagination invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé — Recruteur uniquement., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', list);

/**
 * @openapi
 * /candidates/{id}/stage:
 *   patch:
 *     summary: Transition d'étape (FR-25/FR-26 recruteur, FR-29/FR-39 responsable)
 *     description: >
 *       Ce n'est PAS un endpoint générique de changement d'étape (D-006). Il
 *       exécute la SEULE transition que l'appelant possède, selon son rôle
 *       (D-051).
 *       Recruteur — présélection CV : le candidat doit être à
 *       « Candidature reçue » ; `targetStage` vaut « Présélection CV validée »
 *       ou « Rejeté (CV) » ; un motif est obligatoire pour un rejet et interdit
 *       pour une validation.
 *       Responsable hiérarchique — décision finale : le candidat doit être à
 *       « Évaluation complétée » ; `targetStage` vaut « Accepté » ou
 *       « Rejeté » ; `decisionComment` est obligatoire dans les DEUX cas.
 *       Réservé au responsable ASSIGNÉ à l'entretien du candidat.
 *       Toute autre étape cible est refusée (400) pour les deux rôles, et les
 *       étapes terminales sont définitives.
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetStage]
 *             properties:
 *               targetStage:
 *                 type: string
 *                 enum: ['Présélection CV validée', 'Rejeté (CV)', 'Accepté', 'Rejeté']
 *               rejectionReason:
 *                 type: string
 *                 description: FR-26 — obligatoire si targetStage vaut « Rejeté (CV) ».
 *               decisionComment:
 *                 type: string
 *                 description: FR-29 — obligatoire pour « Accepté » ET « Rejeté ».
 *     responses:
 *       200: { description: Étape mise à jour. }
 *       400: { description: Étape cible non autorisée pour ce rôle, ou motif/commentaire manquant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Responsable non assigné à ce candidat., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Candidat inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Le candidat n'est pas à l'étape requise pour cette transition., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
// (registered above the Recruteur-only router.use — see near the top of this
// file. The @openapi block stays here; swagger-jsdoc scans comments, not
// registration order.)

/**
 * @openapi
 * /candidates/{id}/resume:
 *   post:
 *     summary: Téléverse ou remplace le CV d'un candidat (FR-21, FR-22)
 *     description: >
 *       Le fichier est validé côté serveur AVANT tout envoi vers le stockage
 *       externe (D-007, D-040) : type MIME déclaré, signature binaire réelle
 *       (magic bytes) et taille maximale de 5 Mo. Un exécutable renommé en
 *       « .pdf » est rejeté ici, jamais stocké.
 *       FR-22 : le CV précédent est supprimé du stockage et sa ligne passée à
 *       `isActive: false` — un seul CV actif par candidat.
 *     tags: [Candidates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF ou DOCX, 5 Mo maximum.
 *     responses:
 *       201: { description: CV enregistré. Aucune URL de stockage n'est renvoyée (D-040). }
 *       400: { description: Fichier absent, trop volumineux, type non autorisé ou contenu invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Candidat inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       503: { description: Stockage non configuré., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/:id/resume', uploadResume, putResume);

// GET /:id/resume is registered ABOVE the Recruteur-only router.use, because
// FR-35 grants it to the Responsable hiérarchique as well (D-047).

export default router;

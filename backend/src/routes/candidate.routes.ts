import { Router } from 'express';
import { register, putResume, getResume } from '../controllers/candidate.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { uploadResume } from '../middleware/upload.middleware';
import { Role } from '../common/constants';

const router = Router();

// SRS.md heads this module "Gestion des candidats (Recruteur, sauf précision)",
// and FR-19 reads "Le recruteur peut enregistrer". Router-wide so rule 1 holds
// for any route added later.
//
// The "sauf précision" roles arrive with their own FRs — FR-28/FR-29 give the
// Responsable hiérarchique evaluation and final-decision actions. Nothing is
// granted here ahead of the FR that calls for it.
router.use(requireAuth, requireRole(Role.Recruteur));

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

/**
 * @openapi
 * /candidates/{id}/resume:
 *   get:
 *     summary: Télécharge le CV actif d'un candidat (FR-23)
 *     description: >
 *       D-040 : le fichier transite PAR le backend (proxy), il n'y a pas de
 *       redirection vers une URL de stockage. Les CV sont stockés en mode
 *       « authenticated » : aucune URL publique n'existe, donc le contrôle
 *       d'accès de cette route est le seul chemin vers un CV.
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
 *       404: { description: Candidat inexistant ou aucun CV téléversé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/:id/resume', getResume);

export default router;

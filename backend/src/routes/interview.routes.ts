import { Router } from 'express';
import { create, list, cancel, evaluate } from '../controllers/interview.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// Every route needs a session (rule 1). Roles are then set PER ROUTE rather
// than router-wide, because this module is genuinely mixed: FR-30 and FR-33
// are the Recruteur's, FR-35 to FR-39 are the Responsable hiérarchique's.
// Each route below therefore carries its own requireRole — none may be added
// without one.
router.use(requireAuth);

/**
 * @openapi
 * /interviews:
 *   post:
 *     summary: Planifie un entretien (FR-30 à FR-32) — Recruteur uniquement
 *     description: >
 *       Le candidat doit être à l'étape « Présélection CV validée » (FR-30) et
 *       l'intervenant doit être un responsable hiérarchique actif du
 *       département du poste — vérifié côté serveur à partir du poste du
 *       candidat, jamais d'après la requête (NFR-04).
 *       FR-31 : le système signale tout entretien du même responsable dans une
 *       fenêtre de 30 minutes avant ou après le créneau demandé (D-005). Les
 *       entretiens annulés sont ignorés.
 *       FR-32 : un conflit est un AVERTISSEMENT (409) et non un blocage —
 *       renvoyer la demande avec `confirmDespiteConflict: true` confirme le
 *       créneau malgré le conflit.
 *       FR-27 : en cas de succès, le candidat passe automatiquement à l'étape
 *       « Entretien planifié ». Cette transition est un effet de bord de cette
 *       action et n'est exposée par aucune route (D-006).
 *     tags: [Interviews]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [candidateId, interviewerId, scheduledAt]
 *             properties:
 *               candidateId: { type: string }
 *               interviewerId:
 *                 type: string
 *                 description: Responsable hiérarchique actif du département du poste.
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: Date et heure de début, au format ISO 8601. Doit être dans le futur.
 *               confirmDespiteConflict:
 *                 type: boolean
 *                 description: FR-32 — confirme le créneau malgré un conflit détecté.
 *     responses:
 *       201: { description: Entretien planifié. Le candidat est passé à « Entretien planifié ». }
 *       400: { description: Champ manquant, date invalide ou passée, ou intervenant non éligible., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Candidat inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Candidat à une étape incompatible, ou conflit d'agenda non confirmé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', requireRole(Role.Recruteur), create);

/**
 * @openapi
 * /interviews:
 *   get:
 *     summary: Liste les entretiens planifiés (FR-33) — Recruteur uniquement
 *     description: >
 *       Filtrable par date, responsable hiérarchique et poste, avec pagination
 *       et tri. Les mêmes données alimentent une vue liste ou calendrier ; le
 *       rendu calendrier est un travail frontend.
 *       D-045 : seuls les entretiens au statut « Planifié » sont renvoyés par
 *       défaut — FR-33 parle des entretiens *planifiés*, et une vue encombrée
 *       de créneaux annulés donnerait une fausse image de la charge du
 *       responsable. `includeCancelled=true` renvoie tous les statuts.
 *       Le total avant pagination est renvoyé dans `X-Total-Count`.
 *       Une valeur de filtre inconnue est refusée avec un 400.
 *     tags: [Interviews]
 *     parameters:
 *       - in: query
 *         name: interviewerId
 *         schema: { type: string }
 *       - in: query
 *         name: jobPositionId
 *         schema: { type: string }
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: includeCancelled
 *         schema: { type: string, enum: ['true', 'false'], default: 'false' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [scheduledAt, status], default: scheduledAt }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *     responses:
 *       200:
 *         description: Liste des entretiens, avec candidat, poste et responsable.
 *         headers:
 *           X-Total-Count:
 *             description: Nombre total d'entretiens correspondant au filtre, avant pagination.
 *             schema: { type: integer }
 *       400: { description: Filtre, tri ou pagination invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé — Recruteur uniquement (FR-35 couvrira le responsable)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
// FR-33 (Recruteur, unscoped) and FR-35 (Responsable, scoped to their own
// assigned interviews) are the same endpoint — Section 9 lists one GET and
// sets no role. The scoping is applied server-side from the session, never
// from the query (D-047).
router.get('/', requireRole(Role.Recruteur, Role.ResponsableHierarchique), list);

/**
 * @openapi
 * /interviews/{id}/cancel:
 *   post:
 *     summary: Annule un entretien planifié (FR-34) — Recruteur uniquement
 *     description: >
 *       Le motif est obligatoire et vérifié par le service, pas seulement par
 *       le schéma (D-046) : un motif vide ou absent renvoie 400
 *       CANCELLATION_REASON_REQUIRED avant toute écriture.
 *       Le candidat revient à « Présélection CV validée » — cette annulation
 *       et ce retour en arrière forment une seule intention (FR-34) : si le
 *       candidat a déjà dépassé « Entretien planifié », l'annulation entière
 *       est refusée (409) plutôt que d'être appliquée à moitié.
 *       Seul un entretien « Planifié » peut être annulé ; un entretien déjà
 *       annulé renvoie 409 et n'est jamais retraité.
 *       Deux entrées d'audit sont écrites : EntretienAnnule (Interview) et
 *       EtapeCandidatModifiee (Candidate) — rule 4 nomme les deux.
 *     tags: [Interviews]
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
 *             required: [cancellationReason]
 *             properties:
 *               cancellationReason:
 *                 type: string
 *                 description: FR-34 — motif obligatoire, non vide.
 *     responses:
 *       200: { description: Entretien annulé, candidat revenu à « Présélection CV validée ». }
 *       400: { description: Motif manquant ou vide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Entretien inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Entretien déjà annulé, ou candidat trop avancé pour revenir en arrière., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/:id/cancel', requireRole(Role.Recruteur), cancel);

/**
 * @openapi
 * /interviews/{id}/evaluation:
 *   post:
 *     summary: Soumet l'évaluation d'un entretien (FR-36, FR-37)
 *     description: >
 *       Réservé au responsable hiérarchique ASSIGNÉ à cet entretien (D-048) —
 *       même prédicat que sa liste FR-35 et que l'accès au CV, de sorte que
 *       les entretiens qu'il voit, les CV qu'il lit et ceux qu'il peut évaluer
 *       ne forment qu'un seul ensemble. Le recruteur planifie et annule, il
 *       n'évalue pas.
 *       FR-37 : les trois notes sont obligatoires, entières, de 1 à 5. Un
 *       formulaire incomplet est refusé sans rien écrire.
 *       L'entretien doit être « Planifié » et son créneau déjà passé
 *       (FR-36 : « Après un entretien »). Un entretien annulé est refusé.
 *       La soumission marque l'entretien « Réalisé » — c'est la seule chose
 *       dans le système qui attribue ce statut. Une seule évaluation par
 *       entretien.
 *       NON CÂBLÉ ICI : le passage du candidat à « Évaluation complétée »
 *       (FR-28) et la notification au recruteur (FR-41) arrivent avec FR-38.
 *     tags: [Interviews]
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
 *             required: [scores]
 *             properties:
 *               scores:
 *                 type: object
 *                 required: [technicalSkills, communication, overallFit]
 *                 properties:
 *                   technicalSkills: { type: integer, minimum: 1, maximum: 5 }
 *                   communication: { type: integer, minimum: 1, maximum: 5 }
 *                   overallFit: { type: integer, minimum: 1, maximum: 5 }
 *               comments:
 *                 type: string
 *                 description: Facultatif (FR-36 fournit le champ, FR-37 n'impose que les notes).
 *     responses:
 *       201: { description: Évaluation enregistrée, entretien marqué « Réalisé ». }
 *       400: { description: Note manquante, non entière ou hors échelle., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé, ou entretien non assigné à ce responsable., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       404: { description: Entretien inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Entretien annulé, pas encore tenu, ou déjà évalué., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/:id/evaluation', requireRole(Role.ResponsableHierarchique), evaluate);

export default router;

import { Router } from 'express';
import { create, list, cancel } from '../controllers/interview.controller';
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
router.get('/', requireRole(Role.Recruteur), list);

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

export default router;

import { Router } from 'express';
import { create } from '../controllers/interview.controller';
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

export default router;

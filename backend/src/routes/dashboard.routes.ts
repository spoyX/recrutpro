import { Router } from 'express';
import { show } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/rbac.middleware';

const router = Router();

// UC-14 lists « Visualiser le tableau de bord » under "Tous les rôles", and
// FR-45/46/47 give each role its own. So authentication is the only gate: the
// role does not decide ACCESS, it decides WHICH dashboard is returned, and
// that is resolved server-side from the session.
router.use(requireAuth);

/**
 * @openapi
 * /dashboard:
 *   get:
 *     summary: Tableau de bord de l'utilisateur connecté (FR-45, FR-46, FR-47)
 *     description: >
 *       Route AJOUTÉE HORS du contrat de la Section 9 (voir D-057), qui ne
 *       prévoit aucun endpoint de tableau de bord alors que FR-45 à FR-47 en
 *       exigent un par rôle.
 *       La réponse dépend du RÔLE de l'utilisateur connecté, lu depuis la
 *       session et jamais depuis la requête. Le champ `role` indique la forme
 *       renvoyée :
 *         - `Recruteur` (FR-45) : `openPositions`, `candidatesByStage`,
 *           `recentCandidates`.
 *         - `ResponsableHierarchique` (FR-46) :
 *           `departmentCandidatesInProgress`, `candidatesByStage`,
 *           `upcomingInterviews`, `pendingEvaluations` — le tout limité à son
 *           département (règle 2, D-047).
 *         - `Administrateur` (FR-47) : `activeUsers`, `recentAuditEntries`.
 *       `candidatesByStage` contient TOUJOURS les sept étapes du pipeline,
 *       y compris celles à zéro.
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Indicateurs clés correspondant au rôle de l'appelant.
 *       401: { description: Non authentifié., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Responsable hiérarchique sans département rattaché., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', show);

export default router;

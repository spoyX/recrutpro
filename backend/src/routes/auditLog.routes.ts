import { Router } from 'express';
import { list } from '../controllers/auditLog.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// ARCHITECTURE.md Section 9 states the role outright: "Audit: GET /audit-logs
// (Administrateur only)". PRD Section 3 agrees — auditing activity is the
// administrator's job. Applied with router.use so a route added here later
// cannot be reachable without it (rule 1, the D-038 lesson).
router.use(requireAuth, requireRole(Role.Administrateur));

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     summary: Journal d'audit (UC-04) — Administrateur uniquement
 *     description: >
 *       Les 50 entrées les plus récentes, de la plus récente à la plus
 *       ancienne, filtrables par `action` et `targetType`.
 *       Le total correspondant au filtre AVANT le plafond de 50 est renvoyé
 *       dans `X-Total-Count`, et le plafond lui-même dans `X-Page-Limit` :
 *       c'est ainsi qu'un administrateur sait que les 50 lignes affichées ne
 *       sont pas la totalité.
 *       Une valeur de filtre inconnue est refusée avec un 400 — jamais
 *       ignorée, ce qui donnerait un journal faussement vide.
 *       Chaque entrée porte le NOM de l'utilisateur ayant agi, et jamais de
 *       contenu métier (D-033 : qui / quoi / quand uniquement).
 *       La consultation du journal n'est elle-même pas auditée.
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: targetType
 *         schema: { type: string, enum: [User, Department, JobPosition, Candidate, Interview, InterviewEvaluation] }
 *     responses:
 *       200:
 *         description: Les 50 entrées les plus récentes correspondant au filtre.
 *         headers:
 *           X-Total-Count:
 *             description: Nombre total d'entrées correspondant au filtre, avant le plafond de 50.
 *             schema: { type: integer }
 *           X-Page-Limit:
 *             description: Le plafond appliqué (50).
 *             schema: { type: integer }
 *       400: { description: Valeur de filtre inconnue., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé — Administrateur uniquement., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', list);

export default router;

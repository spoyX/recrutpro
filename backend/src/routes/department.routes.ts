import { Router } from 'express';
import { list, create, rename, deactivate, reactivate } from '../controllers/department.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// Every route needs a session (rule 1). Read is open to all authenticated
// roles because a Recruteur must be able to pick a department when creating a
// job position (FR-14); only management is Administrateur-only (FR-13).
router.use(requireAuth);

/**
 * @openapi
 * /departments:
 *   get:
 *     summary: Liste les départements (FR-13)
 *     description: >
 *       Renvoie par défaut les départements actifs uniquement — FR-13 exige
 *       qu'un département désactivé n'apparaisse plus dans les listes de choix.
 *       `includeInactive=true` les inclut, pour l'écran d'administration.
 *     tags: [Departments]
 *     parameters:
 *       - in: query
 *         name: includeInactive
 *         schema: { type: string, enum: ['true', 'false'] }
 *     responses:
 *       200: { description: Liste des départements. }
 */
router.get('/', list);

// FR-13: creating, renaming and (de)activating are Administrateur-only.
router.use(requireRole(Role.Administrateur));

/**
 * @openapi
 * /departments:
 *   post:
 *     summary: Crée un département (FR-13) — Administrateur uniquement
 *     tags: [Departments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201: { description: Département créé. }
 *       409: { description: Nom déjà utilisé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', create);

/**
 * @openapi
 * /departments/{id}:
 *   patch:
 *     summary: Renomme un département (FR-13)
 *     tags: [Departments]
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
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200: { description: Département renommé. }
 *       409: { description: Nom déjà utilisé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.patch('/:id', rename);

/**
 * @openapi
 * /departments/{id}/deactivate:
 *   patch:
 *     summary: Désactive un département (FR-13)
 *     description: >
 *       L'historique est conservé — le document n'est jamais supprimé. Un
 *       département désactivé ne peut plus être assigné (D-030).
 *     tags: [Departments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Département désactivé. }
 */
router.patch('/:id/deactivate', deactivate);

/**
 * @openapi
 * /departments/{id}/reactivate:
 *   patch:
 *     summary: Réactive un département (D-035 — hors FR-13 et hors Section 9)
 *     tags: [Departments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Département réactivé. }
 */
router.patch('/:id/reactivate', reactivate);

export default router;

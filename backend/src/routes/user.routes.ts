import { Router } from 'express';
import {
  create,
  update,
  deactivate,
  reactivate,
  resetPassword,
} from '../controllers/user.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// FR-6 to FR-9 are Administrateur-only. Applied to the whole router rather
// than per route, so rule 1 ("no unprotected routes, no exceptions") cannot be
// broken by forgetting a guard on a route added later.
router.use(requireAuth, requireRole(Role.Administrateur));

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Crée un compte utilisateur (FR-6) — Administrateur uniquement
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password, minLength: 8 }
 *               role:
 *                 type: string
 *                 enum: [Administrateur, Recruteur, ResponsableHierarchique]
 *               departmentId:
 *                 type: string
 *                 description: Requis sauf pour le rôle Administrateur.
 *     responses:
 *       201: { description: Compte créé. Le mot de passe devra être changé à la première connexion. }
 *       400: { description: Requête invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       401: { description: Non authentifié., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       409: { description: Email déjà utilisé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', create);

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     summary: Modifie le nom, le rôle ou le département (FR-7)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               role:
 *                 type: string
 *                 enum: [Administrateur, Recruteur, ResponsableHierarchique]
 *               departmentId: { type: string }
 *     responses:
 *       200: { description: Compte mis à jour. }
 *       404: { description: Utilisateur introuvable., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.patch('/:id', update);

/**
 * @openapi
 * /users/{id}/deactivate:
 *   patch:
 *     summary: Désactive un compte, empêchant toute connexion (FR-8)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Compte désactivé. Les sessions actives cessent de fonctionner immédiatement. }
 *       400: { description: Auto-désactivation refusée., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.patch('/:id/deactivate', deactivate);

/**
 * @openapi
 * /users/{id}/reactivate:
 *   patch:
 *     summary: Réactive un compte précédemment désactivé (FR-9)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Compte réactivé. }
 */
router.patch('/:id/reactivate', reactivate);

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     summary: Génère un mot de passe temporaire (FR-10)
 *     description: >
 *       Le mot de passe temporaire est renvoyé UNE SEULE FOIS dans la réponse,
 *       à l'administrateur qui en fait la demande (D-031). Il n'est jamais
 *       stocké en clair et devra être changé à la prochaine connexion.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user: { type: object }
 *                 temporaryPassword: { type: string }
 *                 message: { type: string }
 *       404:
 *         description: Utilisateur introuvable.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/:id/reset-password', resetPassword);

export default router;

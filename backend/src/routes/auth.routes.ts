import { Router } from 'express';
import { login, logout, changePassword } from '../controllers/auth.controller';
import { loginRateLimiter } from '../middleware/rateLimit.middleware';
import { requireAuthAllowingPasswordChange } from '../middleware/rbac.middleware';

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authentifie un utilisateur et ouvre une session (FR-1, FR-2)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Session ouverte. Le cookie de session est renvoyé.
 *       400:
 *         description: Corps de requête invalide.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: >
 *           Échec d'authentification. FR-3 — message unique, identique que
 *           l'email soit inconnu, le mot de passe erroné ou le compte désactivé.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Trop de tentatives (D-025 — 5 par IP par 15 minutes).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/login', loginRateLimiter, login);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Termine la session courante (FR-4)
 *     tags: [Auth]
 *     responses:
 *       204:
 *         description: >
 *           Session détruite côté serveur et cookie effacé. Idempotent —
 *           répond 204 même sans session active.
 */
router.post('/logout', logout);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     summary: L'utilisateur connecté change son propre mot de passe (FR-10)
 *     description: >
 *       Route hors du contrat ARCHITECTURE.md Section 9 — voir D-032. FR-10
 *       impose un changement obligatoire à la prochaine connexion, ce qui est
 *       impossible sans un point d'entrée pour l'effectuer.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       204: { description: Mot de passe changé. mustChangePassword est levé. }
 *       400: { description: Requête invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       401: { description: Mot de passe actuel incorrect., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
// Uses the variant that tolerates mustChangePassword — this is the one route a
// locked-out user must be able to reach.
router.post('/change-password', requireAuthAllowingPasswordChange, changePassword);

export default router;

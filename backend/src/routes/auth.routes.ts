import { Router } from 'express';
import { login } from '../controllers/auth.controller';

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
 */
router.post('/login', login);

export default router;

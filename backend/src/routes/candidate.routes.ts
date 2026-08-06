import { Router } from 'express';
import { register } from '../controllers/candidate.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
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

export default router;

import { Router } from 'express';
import { list, create, getOne, update, close } from '../controllers/jobPosition.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// D-037: Recruteur, NOT Administrateur. SRS.md heads this module "Gestion des
// postes (Recruteur)" and FR-14/15/16/17 each begin "Le recruteur peut"; PRD
// Section 3 scopes Administrateur to accounts, departments and audit. Applied
// router-wide so rule 1 holds for any route added later.
router.use(requireAuth, requireRole(Role.Recruteur));

/**
 * @openapi
 * /job-positions:
 *   get:
 *     summary: Liste les postes, filtrable par statut et département (FR-17)
 *     tags: [JobPositions]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Brouillon, Ouvert, Clôturé] }
 *       - in: query
 *         name: departmentId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste des postes, les plus récents d'abord. }
 *       403: { description: Rôle non autorisé (D-037)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', list);

/**
 * @openapi
 * /job-positions:
 *   post:
 *     summary: Crée un poste (FR-14) — Recruteur uniquement
 *     description: >
 *       Le statut accepté est « Ouvert » ou « Brouillon » (défaut). « Clôturé »
 *       est refusé : il n'est atteignable que par l'action de clôture (D-037).
 *       La date de création est enregistrée automatiquement.
 *     tags: [JobPositions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, departmentId, description]
 *             properties:
 *               title: { type: string }
 *               departmentId:
 *                 type: string
 *                 description: Doit désigner un département existant et actif (D-030).
 *               description: { type: string }
 *               requirements: { type: string }
 *               status: { type: string, enum: [Brouillon, Ouvert] }
 *     responses:
 *       201: { description: Poste créé. }
 *       400: { description: Champ manquant, statut interdit ou département inactif., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', create);

/**
 * @openapi
 * /job-positions/{id}:
 *   get:
 *     summary: Consulte un poste (FR-17)
 *     tags: [JobPositions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Le poste demandé. }
 *       404: { description: Poste inexistant., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/:id', getOne);

/**
 * @openapi
 * /job-positions/{id}:
 *   patch:
 *     summary: Modifie un poste non clôturé (FR-15)
 *     description: >
 *       Tous les champs sont modifiables sauf la date de création, immuable au
 *       niveau du schéma. Un poste clôturé n'est plus modifiable (D-037).
 *     tags: [JobPositions]
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
 *             properties:
 *               title: { type: string }
 *               departmentId: { type: string }
 *               description: { type: string }
 *               requirements: { type: string }
 *               status: { type: string, enum: [Brouillon, Ouvert] }
 *     responses:
 *       200: { description: Poste modifié. }
 *       409: { description: Poste clôturé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.patch('/:id', update);

/**
 * @openapi
 * /job-positions/{id}/close:
 *   post:
 *     summary: Clôture un poste (FR-16)
 *     description: >
 *       Empêche le rattachement de tout nouveau candidat à ce poste (FR-16,
 *       seconde moitié, appliquée à l'enregistrement d'un candidat en FR-19).
 *     tags: [JobPositions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Poste clôturé. }
 *       409: { description: Poste déjà clôturé., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/:id/close', close);

// FR-18: NO delete route, deliberately. Section 9 lists none, and closure is
// the only removal path — a position with candidates attached must never
// disappear. tests/jobPosition.spec.ts pins this by asserting DELETE is unrouted.

export default router;

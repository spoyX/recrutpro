import { Router } from 'express';
import { list, create, getOne, update, close } from '../controllers/jobPosition.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// Every route needs a session (rule 1).
router.use(requireAuth);

// D-038 (amends D-037): reads are open to Recruteur AND Administrateur.
// Responsable hiérarchique gets nothing here — a "poste" reaches them through
// the candidate and interview endpoints instead (FR-35, FR-46).
//
// READS ARE DECLARED FIRST, then the write guard, then the writes. That order
// is load-bearing, not cosmetic: router.use only guards what is registered
// AFTER it, so a write route declared above it would be left with reader
// permissions.
const canRead = requireRole(Role.Recruteur, Role.Administrateur);

/**
 * @openapi
 * /job-positions:
 *   get:
 *     summary: Liste les postes, filtrable par statut et département (FR-17)
 *     description: Lecture ouverte au Recruteur et à l'Administrateur (D-038).
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
 *       403: { description: Rôle non autorisé — Responsable hiérarchique (D-038)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', canRead, list);

/**
 * @openapi
 * /job-positions/{id}:
 *   get:
 *     summary: Consulte un poste (FR-17) — Recruteur ou Administrateur (D-038)
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
router.get('/:id', canRead, getOne);

// D-038: everything below WRITES, and writing is Recruteur-only —
// Administrateur is read-only here. Applied with router.use rather than per
// route so a write route added later is Recruteur-only by default (rule 1).
router.use(requireRole(Role.Recruteur));

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
 *       403: { description: Rôle non autorisé — l'Administrateur est en lecture seule (D-038)., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.post('/', create);

/**
 * @openapi
 * /job-positions/{id}:
 *   patch:
 *     summary: Modifie un poste non clôturé (FR-15) — Recruteur uniquement
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
 *     summary: Clôture un poste (FR-16) — Recruteur uniquement
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

// FR-18: NO delete route, deliberately — confirmed by the human 2026-08-05.
// Section 9 lists none, and closure is the only removal path: a position with
// candidates attached must never disappear.
// tests/jobPosition.spec.ts pins this by asserting DELETE is unrouted.

export default router;

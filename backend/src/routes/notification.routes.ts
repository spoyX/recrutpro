import { Router } from 'express';
import { list, markRead, remove } from '../controllers/notification.controller';
import { requireAuth } from '../middleware/rbac.middleware';

const router = Router();

// D-054: authentication is the only gate. All three roles receive
// notifications (FR-40 recruiter + responsable, FR-41 recruiter, FR-42
// responsable), so there is no requireRole here — the restriction is not on
// the ROLE but on the RECIPIENT, and that is enforced in the service, which
// scopes every query to the session user.
router.use(requireAuth);

/**
 * @openapi
 * /notifications:
 *   get:
 *     summary: Liste les notifications de l'utilisateur connecté (FR-43)
 *     description: >
 *       Renvoie uniquement les notifications de l'utilisateur connecté — la
 *       portée vient de la session, jamais de la requête (D-054). Triées de la
 *       plus récente à la plus ancienne.
 *       Le filtre `isRead` est à trois états : absent = toutes, `false` = non
 *       lues uniquement (c'est ainsi que le compteur de non-lues est obtenu,
 *       via `X-Total-Count`), `true` = lues uniquement.
 *       Le total avant pagination est renvoyé dans `X-Total-Count`.
 *       Une valeur de filtre ou de pagination inconnue est refusée avec un 400.
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: isRead
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200:
 *         description: Liste des notifications de l'utilisateur connecté.
 *         headers:
 *           X-Total-Count:
 *             description: Nombre total de notifications correspondant au filtre, avant pagination.
 *             schema: { type: integer }
 *       400: { description: Filtre ou pagination invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       401: { description: Non authentifié., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/', list);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     summary: Marque une notification comme lue (FR-43)
 *     description: >
 *       Idempotent : marquer une notification déjà lue renvoie 200.
 *       Une notification qui n'appartient pas à l'utilisateur connecté renvoie
 *       404, et non 403 (D-054) — « pas la vôtre » et « inexistante » sont
 *       volontairement indiscernables.
 *     tags: [Notifications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Notification marquée comme lue. }
 *       404: { description: Notification inexistante ou appartenant à un autre utilisateur., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.patch('/:id/read', markRead);

/**
 * @openapi
 * /notifications/{id}:
 *   delete:
 *     summary: Supprime une notification (FR-44 — route hors contrat Section 9, D-054)
 *     description: >
 *       FR-44 conserve les notifications jusqu'à leur suppression manuelle par
 *       l'utilisateur, ce qui est impossible avec les seuls GET et PATCH de la
 *       Section 9. Aucune expiration automatique n'existe côté modèle.
 *       Non idempotent : une seconde suppression renvoie 404, la même réponse
 *       que pour la notification d'un autre utilisateur (D-054).
 *     tags: [Notifications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Notification supprimée. }
 *       404: { description: Notification inexistante ou appartenant à un autre utilisateur., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.delete('/:id', remove);

export default router;

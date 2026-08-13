import { Router } from 'express';
import { pipeline, timeToHire } from '../controllers/report.controller';
import { requireAuth, requireRole } from '../middleware/rbac.middleware';
import { Role } from '../common/constants';

const router = Router();

// SRS workflow step 9: « [Recruteur / Responsable hiérarchique] Consulte les
// tableaux de bord et génère des rapports de pipeline ou de délai de
// recrutement. » Both roles, confirmed against SRS.md rather than assumed from
// the neighbouring modules.
//
// The Administrateur is ALSO granted access (D-068), extending D-038's
// oversight rationale — an administrator auditing the system may read what it
// reports. Both routes here are GETs, so "read-only" needs no extra guard:
// this module exposes no write at all.
//
// The Responsable's results are scoped to their own department inside the
// service (rule 2, D-047) — the ROLE decides access, the DEPARTMENT decides
// how much of it they see. The Administrateur is NOT department-scoped
// (D-027), so they see the whole organisation, as D-038 already gives them on
// job positions.
router.use(
  requireAuth,
  requireRole(Role.Recruteur, Role.ResponsableHierarchique, Role.Administrateur),
);

/**
 * @openapi
 * /reports/pipeline:
 *   get:
 *     summary: Rapport de pipeline par poste (SRS §1.5, récit 22)
 *     description: >
 *       Nombre de candidats par étape, pour chaque poste. Sans
 *       `jobPositionId`, tous les postes visibles par l'appelant sont
 *       renvoyés — un par ligne ; avec, uniquement celui-là.
 *       Chaque ligne porte TOUJOURS les sept étapes du pipeline, y compris
 *       celles à zéro, et les postes SANS AUCUN candidat sont inclus avec un
 *       total de 0 : « personne n'a postulé » est un résultat, pas une absence
 *       de résultat.
 *       Un responsable hiérarchique ne voit que les postes de son département
 *       (règle 2, D-047).
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: jobPositionId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Une ligne par poste. }
 *       400: { description: Identifiant de poste invalide., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 *       403: { description: Rôle non autorisé — Recruteur ou Responsable hiérarchique uniquement., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/pipeline', pipeline);

/**
 * @openapi
 * /reports/time-to-hire:
 *   get:
 *     summary: Délai moyen de recrutement sur une période (SRS §1.5, récit 23)
 *     description: >
 *       Délai entre `registeredAt` (D-018) et `decidedAt` (D-058), calculé
 *       uniquement sur les candidats ayant atteint « Accepté » — un rejet
 *       n'est pas un recrutement.
 *       **La période filtre sur `decidedAt`, et non sur `registeredAt`** : le
 *       rapport porte sur les recrutements CONCLUS pendant la période. Filtrer
 *       sur la date de candidature exclurait les recrutements longs non encore
 *       terminés et fausserait la moyenne à la baisse.
 *       `hires` donne la taille de l'échantillon : une moyenne sur deux
 *       recrutements n'est pas une statistique.
 *       En l'absence de recrutement, les moyennes valent `null` et non `0`.
 *       `toDate` au format AAAA-MM-JJ couvre la journée entière.
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Synthèse du délai de recrutement sur la période. }
 *       400: { description: Date invalide ou plage inversée., content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
 */
router.get('/time-to-hire', timeToHire);

export default router;

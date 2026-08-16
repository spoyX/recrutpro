import { Types } from 'mongoose';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { JobPosition } from '../models/JobPosition.model';
import { Interview, IInterview } from '../models/Interview.model';
import { AuditLog, IAuditLog } from '../models/AuditLog.model';
import { User, IUser } from '../models/User.model';
import { Role, CandidateStage, JobPositionStatus, InterviewStatus } from '../common/constants';
import { AppError } from '../common/errors';

/**
 * FR-45 to FR-47 — the role-scoped dashboards.
 *
 * One service, three shapes, because SRS.md gives each role a DIFFERENT set of
 * metrics rather than one dashboard with role-based visibility. The role is
 * taken from the session and never from the request (NFR-04).
 */

/** How many rows the "recent" widgets carry. Not specified by any FR. */
export const RECENT_LIMIT = 5;

/**
 * FR-46 — « le nombre de candidats EN COURS dans son département ».
 *
 * "En cours" is read as "not in a terminal stage": a rejected or accepted
 * candidate is finished, not in progress. The three terminal stages are the
 * two decision outcomes plus the CV-stage rejection (Section 8).
 */
const TERMINAL_STAGES: CandidateStage[] = [
  CandidateStage.Accepte,
  CandidateStage.Rejete,
  CandidateStage.RejeteCv,
];

/**
 * A count per pipeline stage, with EVERY stage present even at zero.
 *
 * Zero-filling is the point: a breakdown that omits empty stages produces a
 * chart whose bars move between renders (FR-45 offers « graphique ou
 * compteurs »), and a caller cannot tell "no candidates" from "stage missing".
 *
 * One aggregation rather than seven `countDocuments` calls.
 */
const stageBreakdown = async (
  match: Record<string, unknown>,
): Promise<Record<string, number>> => {
  const rows: Array<{ _id: string; count: number }> = await Candidate.aggregate([
    { $match: match },
    { $group: { _id: '$currentStage', count: { $sum: 1 } } },
  ]);

  const breakdown: Record<string, number> = {};
  for (const stage of Object.values(CandidateStage)) {
    breakdown[stage] = 0;
  }
  for (const row of rows) {
    if (row._id in breakdown) {
      breakdown[row._id] = row.count;
    }
  }
  return breakdown;
};

export interface RecruteurDashboard {
  role: Role.Recruteur;
  openPositions: number;
  candidatesByStage: Record<string, number>;
  recentCandidates: ICandidate[];
}

export interface ResponsableDashboard {
  role: Role.ResponsableHierarchique;
  departmentCandidatesInProgress: number;
  candidatesByStage: Record<string, number>;
  upcomingInterviews: IInterview[];
  pendingEvaluations: number;
  /** D-088 — the candidates this responsable owes a decision (FR-39). */
  candidatesAwaitingDecision: ICandidate[];
}

export interface AdministrateurDashboard {
  role: Role.Administrateur;
  activeUsers: number;
  recentAuditEntries: IAuditLog[];
}

export type DashboardData = RecruteurDashboard | ResponsableDashboard | AdministrateurDashboard;

/**
 * FR-45 — « le nombre de postes ouverts, la répartition des candidats par
 * étape et les dernières activités (ex : derniers candidats ajoutés) ».
 *
 * NOT department-scoped: D-027 scopes only the Responsable hiérarchique, and
 * D-037/FR-17 give the Recruteur postings across every department.
 *
 * « Postes ouverts » is `Ouvert` only — a `Brouillon` is not open and a
 * `Clôturé` is closed, so counting either would misstate the number FR-45 asks
 * for.
 */
const recruteurDashboard = async (): Promise<RecruteurDashboard> => {
  const [openPositions, candidatesByStage, recentCandidates] = await Promise.all([
    JobPosition.countDocuments({ status: JobPositionStatus.Ouvert }),
    stageBreakdown({}),
    Candidate.find()
      .populate('jobPositionId', 'title')
      .sort({ registeredAt: -1 })
      .limit(RECENT_LIMIT),
  ]);

  return { role: Role.Recruteur, openPositions, candidatesByStage, recentCandidates };
};

/**
 * FR-46 — « le nombre de candidats en cours dans son département, les
 * entretiens à venir et le nombre d'évaluations en attente ».
 *
 * Department scoping follows D-047's established shape: the constraint is
 * entity-specific and resolved per service, NOT through the generic
 * `scopeFilter` helper D-027 imagined and D-047 explicitly rejected.
 *
 * **The candidate metric is department-wide, unlike FR-35's interview list,
 * which is scoped to the Responsable's OWN assignments.** That is what FR-46
 * says — « dans son département », not « qui lui sont assignés » — and user
 * story 30 (« le pipeline pour mon département ») agrees. It is safe to read
 * that literally because FR-46 asks for « le NOMBRE de candidats »: this
 * returns counts only, never candidate rows, so no row-level access is widened
 * beyond what FR-35 already granted.
 */
/**
 * D-088 — the candidates a Responsable hiérarchique owes a DECISION (FR-39).
 *
 * *** NOT a list version of `pendingEvaluations`, which counts something else
 * entirely. *** That counts interviews HELD but not yet evaluated — the
 * responsable owes an EVALUATION. This returns candidates already at
 * « Évaluation complétée »: the evaluation is in, and the decision is owed.
 * Conflating the two would put a candidate on the wrong worklist.
 *
 * *** THIS IS THE FIRST TIME THE FR-46 PAYLOAD RETURNS CANDIDATE ROWS, and the
 * scoping is what makes it safe. *** `responsableDashboard`'s docblock records
 * that FR-46 asks for « le NOMBRE de candidats », so the branch returned counts
 * only and widened no row-level access. These rows are filtered by the SAME two
 * conditions `hasAssignedInterviewWith` applies — the department floor (already
 * baked into `candidateIds`) and an interview assigned to this viewer — so
 * every candidate returned is one FR-35 already grants them. The set is not
 * widened; it is surfaced where the action is.
 */
const awaitingDecisionFor = async (
  viewer: IUser,
  candidateIds: Types.ObjectId[],
): Promise<ICandidate[]> => {
  const assigned = await Interview.find(
    { interviewerId: viewer._id, candidateId: { $in: candidateIds } },
    'candidateId',
  );

  const assignedIds = assigned.map((interview) => interview.candidateId);
  if (assignedIds.length === 0) {
    return [];
  }

  return Candidate.find({
    _id: { $in: assignedIds },
    currentStage: CandidateStage.EvaluationCompletee,
  })
    .populate('jobPositionId', 'title')
    // Newest first with an `_id` tiebreaker (D-069): candidates evaluated in
    // one batch share a timestamp, and an unstable order would reshuffle a
    // worklist between two loads of the same page.
    .sort({ registeredAt: -1, _id: 1 })
    .limit(RECENT_LIMIT);
};

const responsableDashboard = async (viewer: IUser): Promise<ResponsableDashboard> => {
  // Rule 2 has nothing to scope against without a department. D-016 makes it
  // required for this role, so this is a fail-closed guard, not a real path.
  if (!viewer.departmentId) {
    throw new AppError(
      403,
      'FORBIDDEN',
      "Votre compte n'est rattaché à aucun département. Contactez un administrateur.",
    );
  }

  // Two-hop join, the same one `listInterviews` uses: Interview holds
  // candidateId, and the department lives on the candidate's job position.
  const positions = await JobPosition.find({ department: viewer.departmentId }, '_id');
  const positionIds = positions.map((p) => p._id);
  const departmentCandidates = await Candidate.find(
    { jobPositionId: { $in: positionIds } },
    '_id',
  );
  const candidateIds = departmentCandidates.map((c) => c._id);

  const now = new Date();

  const [candidatesByStage, upcomingInterviews, pendingEvaluations, candidatesAwaitingDecision] =
    await Promise.all([
    stageBreakdown({ jobPositionId: { $in: positionIds } }),

    // « Les entretiens à venir » — assigned to them, still planned, in the
    // future. The department floor is applied ON TOP of the assignment, per
    // D-047: redundant while FR-30 holds, load-bearing the moment an
    // administrator moves this user to another department (FR-7).
    Interview.find({
      interviewerId: viewer._id,
      candidateId: { $in: candidateIds },
      status: InterviewStatus.Planifie,
      scheduledAt: { $gt: now },
    })
      .populate({ path: 'candidateId', select: 'fullName jobPositionId', populate: { path: 'jobPositionId', select: 'title' } })
      .populate('interviewerId', 'name')
      .sort({ scheduledAt: 1 })
      .limit(RECENT_LIMIT),

    // « Le nombre d'évaluations en attente » — reuses D-048's acceptance gate
    // verbatim rather than inventing a second definition: an evaluation is
    // accepted for a `Planifié` interview whose slot has PASSED. So this counts
    // exactly the interviews this user can evaluate right now.
    //
    // No join against InterviewEvaluation is needed: submitting an evaluation
    // flips the interview to `Réalisé` (D-048), so a `Planifié` interview has
    // no evaluation behind it. The one exception is D-050's documented
    // non-atomic window, where a crash could leave an evaluation stored against
    // a still-`Planifié` interview — that row stays counted as pending, which
    // is exactly the "visibly un-processed work a retry completes" behaviour
    // D-050 chose.
    Interview.countDocuments({
      interviewerId: viewer._id,
      candidateId: { $in: candidateIds },
      status: InterviewStatus.Planifie,
      scheduledAt: { $lte: now },
    }),

    // D-088 — « Candidats en attente de décision »: FR-39's worklist.
    awaitingDecisionFor(viewer, candidateIds),
  ]);

  const departmentCandidatesInProgress = Object.entries(candidatesByStage)
    .filter(([stage]) => !TERMINAL_STAGES.includes(stage as CandidateStage))
    .reduce((total, [, count]) => total + count, 0);

  return {
    role: Role.ResponsableHierarchique,
    departmentCandidatesInProgress,
    candidatesByStage,
    upcomingInterviews,
    pendingEvaluations,
    candidatesAwaitingDecision,
  };
};

/**
 * FR-47 — « le nombre d'utilisateurs actifs et les dernières entrées du
 * journal d'audit ».
 *
 * The audit entries are read here only. `GET /audit-logs` (Section 9, UC-04)
 * is a separate, filterable view that does not exist yet; this is the
 * dashboard's own last-N slice, served by the `{ timestamp: -1 }` index the
 * AuditLog model already carries for exactly this.
 *
 * The acting user's NAME is populated: a raw ObjectId is unreadable in a
 * surveillance widget (NFR-09), and « qui a fait quoi » is the whole point of
 * user story 8.
 */
const administrateurDashboard = async (): Promise<AdministrateurDashboard> => {
  const [activeUsers, recentAuditEntries] = await Promise.all([
    User.countDocuments({ isActive: true }),
    AuditLog.find()
      .populate('userId', 'name')
      .sort({ timestamp: -1 })
      .limit(RECENT_LIMIT),
  ]);

  return { role: Role.Administrateur, activeUsers, recentAuditEntries };
};

/**
 * UC-14 — « Accéder aux indicateurs clés SELON SON RÔLE ».
 *
 * The role is read from the reloaded session user (D-027), so a caller cannot
 * ask for another role's dashboard.
 */
export const buildDashboard = async (viewer: IUser): Promise<DashboardData> => {
  switch (viewer.role) {
    case Role.Recruteur:
      return recruteurDashboard();
    case Role.ResponsableHierarchique:
      return responsableDashboard(viewer);
    case Role.Administrateur:
      return administrateurDashboard();
    default:
      // Unreachable while Role has three members, but a new role must fail
      // closed rather than silently receive an empty dashboard.
      throw new AppError(
        403,
        'FORBIDDEN',
        "Aucun tableau de bord n'est défini pour votre rôle.",
      );
  }
};

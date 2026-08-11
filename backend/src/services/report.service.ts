import { Types } from 'mongoose';
import { Candidate } from '../models/Candidate.model';
import { JobPosition, IJobPosition } from '../models/JobPosition.model';
import { IUser } from '../models/User.model';
import { CandidateStage } from '../common/constants';
import { AppError } from '../common/errors';
import { isDepartmentScoped } from '../middleware/rbac.middleware';

/**
 * Reports — SRS.md Section 1.5 « Rapports : pipeline par poste et délai moyen
 * de recrutement », user stories 22 and 23, and workflow step 9.
 *
 * Both routes are already in ARCHITECTURE.md Section 9, so nothing here is
 * outside the contract (unlike D-057's dashboard).
 *
 * **Who may read them (SRS-checked, not assumed):** workflow step 9 reads
 * « **[Recruteur / Responsable hiérarchique]** Consulte les tableaux de bord et
 * génère des rapports », so BOTH roles reach these routes. User stories 22 and
 * 23 sit under Recruteur, which is why the Recruteur's view is unscoped and the
 * Responsable's is limited to their own department (rule 2, D-047). The
 * Administrateur is NOT granted access: no SRS text puts reporting in that
 * role, and PRD Section 3 scopes it to accounts, departments and audit.
 */

/** The department floor for a scoped caller; `null` means "no restriction". */
const scopedPositionFilter = (viewer: IUser): Record<string, unknown> | null => {
  if (!isDepartmentScoped(viewer)) {
    return null;
  }
  if (!viewer.departmentId) {
    // Same fail-closed guard as the FR-46 dashboard: no department means
    // nothing to scope against, and the alternative is a global view.
    throw new AppError(
      403,
      'FORBIDDEN',
      "Votre compte n'est rattaché à aucun département. Contactez un administrateur.",
    );
  }
  return { department: viewer.departmentId };
};

export interface PipelineReportRow {
  position: IJobPosition;
  stages: Record<string, number>;
  total: number;
}

/**
 * User story 22 — « un rapport de pipeline pour un poste, affichant le nombre
 * de candidats par étape ». SRS Section 1.5 words it « pipeline par poste ».
 *
 * Both readings are served by one endpoint: without `jobPositionId` it reports
 * every position the caller may see, one row each; with it, exactly that
 * position.
 *
 * **Positions with NO candidates are included, at zero.** "Nobody has applied
 * to this posting" is a real and actionable result — dropping the row would
 * make an empty position indistinguishable from one that does not exist, which
 * is exactly the fact a recruiter communicating progress needs to see.
 *
 * **Every stage is present on every row, zeroes included**, the same rule as
 * the FR-45 dashboard breakdown (D-057): a report whose columns vary per row
 * cannot be put in a table or a chart.
 */
export const pipelineReport = async (
  viewer: IUser,
  jobPositionId?: string,
): Promise<PipelineReportRow[]> => {
  const filter: Record<string, unknown> = { ...(scopedPositionFilter(viewer) ?? {}) };

  if (jobPositionId) {
    if (!Types.ObjectId.isValid(jobPositionId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de poste invalide.');
    }
    // Combined with the department clause rather than replacing it: a scoped
    // caller naming a foreign position gets an empty report, not someone
    // else's data. Narrowing an honest filter is a truthful empty result
    // (D-047's distinction).
    filter._id = jobPositionId;
  }

  const positions = await JobPosition.find(filter).sort({ createdAt: -1 });
  const positionIds = positions.map((p) => p._id);

  const grouped: Array<{ _id: { position: Types.ObjectId; stage: string }; count: number }> =
    await Candidate.aggregate([
      { $match: { jobPositionId: { $in: positionIds } } },
      {
        $group: {
          _id: { position: '$jobPositionId', stage: '$currentStage' },
          count: { $sum: 1 },
        },
      },
    ]);

  const counts = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const key = String(row._id.position);
    if (!counts.has(key)) {
      counts.set(key, {});
    }
    counts.get(key)![row._id.stage] = row.count;
  }

  return positions.map((position) => {
    const found = counts.get(String(position._id)) ?? {};
    const stages: Record<string, number> = {};
    let total = 0;
    for (const stage of Object.values(CandidateStage)) {
      stages[stage] = found[stage] ?? 0;
      total += stages[stage];
    }
    return { position, stages, total };
  });
};

export interface TimeToHireReport {
  fromDate: Date | null;
  toDate: Date | null;
  hires: number;
  averageDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const toDays = (ms: number): number => Math.round((ms / MS_PER_DAY) * 10) / 10;

/**
 * User story 23 — « un rapport de délai de recrutement sur une période ».
 * SRS Section 1.5 calls it « délai moyen de recrutement »; Section 2.1 is the
 * quarterly question that motivates it.
 *
 * The delay is `decidedAt - registeredAt` (D-058 and D-018), measured only over
 * candidates who reached « Accepté » — a rejection is not a hire, and including
 * rejections would measure something the report does not claim to.
 *
 * **The period filters on `decidedAt`, not `registeredAt`. This is the choice
 * that decides whether the number is right.** Filtering on `registeredAt` would
 * report "people who APPLIED this quarter", and the slow hires among them would
 * not have concluded yet — so they would be silently excluded and the average
 * would be biased downward, looking like an improvement. Filtering on
 * `decidedAt` reports "hires COMPLETED this quarter", which is what « en fin de
 * trimestre, on lui demande le délai moyen » actually asks for and cannot
 * exclude a slow hire that finished.
 *
 * `hires` is returned alongside the average deliberately: an average over two
 * hires is not a statistic, and a caller that cannot see the sample size cannot
 * tell. `null` averages rather than `0` when there are no hires — zero days
 * would be a false claim of instant hiring.
 */
export const timeToHireReport = async (
  viewer: IUser,
  fromDate?: Date,
  toDate?: Date,
): Promise<TimeToHireReport> => {
  const positionFilter = scopedPositionFilter(viewer);

  const match: Record<string, unknown> = {
    currentStage: CandidateStage.Accepte,
    // Guards the D-058 gap: candidates accepted before that field existed have
    // no end date and cannot contribute a delay. Counting them as zero would
    // corrupt the average; they are excluded from the sample instead.
    decidedAt: { $ne: null },
  };

  if (fromDate || toDate) {
    const range: Record<string, Date> = {};
    if (fromDate) {
      range.$gte = fromDate;
    }
    if (toDate) {
      range.$lte = toDate;
    }
    match.decidedAt = { ...range, $ne: null };
  }

  if (positionFilter) {
    const positions = await JobPosition.find(positionFilter, '_id');
    match.jobPositionId = { $in: positions.map((p) => p._id) };
  }

  const [summary]: Array<{ hires: number; avgMs: number; minMs: number; maxMs: number }> =
    await Candidate.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          hires: { $sum: 1 },
          avgMs: { $avg: { $subtract: ['$decidedAt', '$registeredAt'] } },
          minMs: { $min: { $subtract: ['$decidedAt', '$registeredAt'] } },
          maxMs: { $max: { $subtract: ['$decidedAt', '$registeredAt'] } },
        },
      },
    ]);

  return {
    fromDate: fromDate ?? null,
    toDate: toDate ?? null,
    hires: summary?.hires ?? 0,
    averageDays: summary ? toDays(summary.avgMs) : null,
    fastestDays: summary ? toDays(summary.minMs) : null,
    slowestDays: summary ? toDays(summary.maxMs) : null,
  };
};

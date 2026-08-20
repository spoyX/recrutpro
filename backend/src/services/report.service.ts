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
 * Responsable's is limited to their own department (rule 2, D-047).
 *
 * **The Administrateur IS granted access, since D-068.** This paragraph used to
 * say the opposite — the original reasoning was that no SRS text puts reporting
 * in that role — and D-068 overturned it, extending D-038's oversight rationale
 * so the role reads everything and writes nothing. `report.routes.ts` has named
 * all three roles since; only this comment was left behind. Corrected on
 * 2026-08-15 rather than left to send a future reader "fixing" the route the
 * wrong way. They are NOT department-scoped (D-027), so they see everything.
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

/**
 * One month of the D-110 series.
 *
 * *** `averageDays` IS NULL, NEVER 0, FOR A MONTH WITH NO HIRES. ***
 * `hires: 0` is a true statement - nobody was hired. `averageDays: 0` would be
 * a false one: it claims those nobodies were hired instantly, and on a trend
 * line it draws a plunge to the axis that reads as a dramatic improvement. The
 * flat summary beside it has always returned `null` rather than `0` for an
 * empty sample, for exactly this reason; the series inherits the rule.
 */
export interface TimeToHireMonth {
  /** `YYYY-MM`, in SERIES_TIMEZONE. */
  month: string;
  hires: number;
  averageDays: number | null;
}

export interface TimeToHireReport {
  fromDate: Date | null;
  toDate: Date | null;
  hires: number;
  averageDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
  /**
   * D-110 - the same sample as the summary above, grouped by month and
   * ZERO-FILLED across the window so a quiet month is a visible zero rather
   * than a missing point. A gap in the array would let a chart draw a straight
   * line between two distant months and imply data that does not exist.
   */
  byMonth: TimeToHireMonth[];
}

/**
 * The timezone the months are cut on.
 *
 * EXPLICIT, because the default is not neutral: `$dateToString` without a
 * timezone groups in UTC, so a hire decided at 00:30 on 1 March in Paris lands
 * in February for every reader of this report. The application is French and
 * its users read these months as French calendar months.
 */
const SERIES_TIMEZONE = 'Europe/Paris';

/** Months returned when the caller gives no range. */
const DEFAULT_SERIES_MONTHS = 12;

/**
 * Hard ceiling on the series length.
 *
 * Without one the window runs from whatever `fromDate` the caller sends to
 * `toDate`, and `?fromDate=1970-01-01` would return 670 points - a request that
 * costs the server nothing to answer and the browser a great deal to draw. When
 * a range is wider than this, the MOST RECENT months win: a trend is read from
 * its right-hand end.
 */
const MAX_SERIES_MONTHS = 24;

/**
 * `YYYY-MM` for an instant, in SERIES_TIMEZONE.
 *
 * Uses `Intl` rather than `toISOString().slice(0, 7)`, which would silently be
 * UTC and disagree with the aggregation's own `$dateToString` above - the two
 * MUST cut the months identically or the zero-fill would create a phantom
 * month beside a real one.
 */
const monthKey = (at: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SERIES_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
};

/** `n` months before `at`, on a mid-month UTC cursor. */
const monthsBack = (at: Date, n: number): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - n, 15));

/**
 * Every `YYYY-MM` from `start` to `end` inclusive, oldest first.
 *
 * The cursor sits mid-month deliberately: stepping a 31st forward by one month
 * skips February entirely, and the 15th is far enough from either edge that a
 * timezone shift cannot move it into a neighbouring month.
 *
 * The caller caps the START rather than letting this run long — an earlier
 * version walked from the caller's `fromDate` and sliced afterwards, and a
 * `fromDate=1970-01-01` needed 672 steps against a 600-step guard, so the
 * series silently ENDED in 2019. Bounding the input is what makes the guard
 * unreachable instead of load-bearing.
 */
const monthsBetween = (start: Date, end: Date): string[] => {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 15));
  const last = monthKey(end);
  for (let guard = 0; guard <= MAX_SERIES_MONTHS + 2; guard += 1) {
    const key = monthKey(cursor);
    keys.push(key);
    if (key >= last) break;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
};

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

  // ONE round trip for both shapes. `$facet` runs the flat summary and the
  // monthly series over the SAME `$match`, so the chart can never disagree with
  // the averages printed beside it - two queries could, if a decision landed
  // between them.
  const [faceted]: Array<{
    summary: Array<{ hires: number; avgMs: number; minMs: number; maxMs: number }>;
    months: Array<{ _id: string; hires: number; avgMs: number }>;
  }> = await Candidate.aggregate([
    { $match: match },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              hires: { $sum: 1 },
              avgMs: { $avg: { $subtract: ['$decidedAt', '$registeredAt'] } },
              minMs: { $min: { $subtract: ['$decidedAt', '$registeredAt'] } },
              maxMs: { $max: { $subtract: ['$decidedAt', '$registeredAt'] } },
            },
          },
        ],
        // D-110. `timezone` is explicit - see SERIES_TIMEZONE.
        months: [
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$decidedAt',
                  timezone: SERIES_TIMEZONE,
                },
              },
              hires: { $sum: 1 },
              avgMs: { $avg: { $subtract: ['$decidedAt', '$registeredAt'] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const summary = faceted?.summary?.[0];
  const found = new Map((faceted?.months ?? []).map((m) => [m._id, m]));

  // The WINDOW the series covers, bounded rather than open-ended. An explicit
  // range wins; otherwise the last DEFAULT_SERIES_MONTHS ending now.
  const end = toDate ?? new Date();
  const requested = fromDate ?? monthsBack(end, DEFAULT_SERIES_MONTHS - 1);
  // The cap is applied to the START, not by slicing a long list afterwards: a
  // wide `fromDate` must never make this walk thousands of months just to throw
  // most of them away. The most recent months win — a trend is read from its
  // right-hand end.
  const floor = monthsBack(end, MAX_SERIES_MONTHS - 1);
  const start = requested > floor ? requested : floor;

  const window = monthsBetween(start > end ? end : start, end).slice(-MAX_SERIES_MONTHS);

  const byMonth: TimeToHireMonth[] = window.map((month) => {
    const row = found.get(month);
    return {
      month,
      hires: row?.hires ?? 0,
      // Null, never 0 - see TimeToHireMonth.
      averageDays: row ? toDays(row.avgMs) : null,
    };
  });

  return {
    fromDate: fromDate ?? null,
    toDate: toDate ?? null,
    hires: summary?.hires ?? 0,
    averageDays: summary ? toDays(summary.avgMs) : null,
    fastestDays: summary ? toDays(summary.minMs) : null,
    slowestDays: summary ? toDays(summary.maxMs) : null,
    byMonth,
  };
};

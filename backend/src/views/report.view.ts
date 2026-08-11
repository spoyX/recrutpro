import { PipelineReportRow, TimeToHireReport } from '../services/report.service';
import { JobPositionStatus } from '../common/constants';

/** The "V" of MVC (D-003): the JSON shape each report takes on the way out. */

export interface PublicPipelineRow {
  jobPosition: { id: string; title: string; status: JobPositionStatus };
  /** Every pipeline stage, always — including the ones at zero. */
  stages: Record<string, number>;
  total: number;
}

export const toPublicPipelineRow = (row: PipelineReportRow): PublicPipelineRow => ({
  jobPosition: {
    id: String(row.position._id),
    title: row.position.title,
    // The status is carried because a pipeline of zero on a CLOSED position
    // reads very differently from the same zero on an open one.
    status: row.position.status,
  },
  stages: row.stages,
  total: row.total,
});

export interface PublicTimeToHire {
  fromDate: string | null;
  toDate: string | null;
  /** The sample size. Returned so a caller can see what the average rests on. */
  hires: number;
  averageDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
}

export const toPublicTimeToHire = (report: TimeToHireReport): PublicTimeToHire => ({
  fromDate: report.fromDate ? report.fromDate.toISOString() : null,
  toDate: report.toDate ? report.toDate.toISOString() : null,
  hires: report.hires,
  // Null rather than 0 when there are no hires: zero days would be a false
  // claim of instant hiring rather than an absence of data.
  averageDays: report.averageDays,
  fastestDays: report.fastestDays,
  slowestDays: report.slowestDays,
});

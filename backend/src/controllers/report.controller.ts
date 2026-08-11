import { RequestHandler } from 'express';
import { pipelineReport, timeToHireReport } from '../services/report.service';
import { toPublicPipelineRow, toPublicTimeToHire } from '../views/report.view';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/**
 * A date-only upper bound covers the WHOLE day — the same rule as the candidate
 * and interview lists (D-041). `toDate=2026-08-11` parsed at midnight would
 * silently drop every hire decided that day, and the report would look right.
 */
const asDateFilter = (value: unknown, label: string, endOfDay = false): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalid(`« ${label} » doit être une date au format AAAA-MM-JJ.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`« ${label} » n'est pas une date valide. Utilisez le format AAAA-MM-JJ.`);
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
};

/** GET /api/v1/reports/pipeline — SRS Section 1.5, user story 22 */
export const pipeline: RequestHandler = async (req, res, next) => {
  try {
    const { jobPositionId } = req.query;

    if (jobPositionId !== undefined && typeof jobPositionId !== 'string') {
      throw invalid('« jobPositionId » doit être un identifiant unique.');
    }

    const rows = await pipelineReport(req.currentUser!, jobPositionId);
    res.status(200).json(rows.map(toPublicPipelineRow));
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/reports/time-to-hire — SRS Section 1.5, user story 23 */
export const timeToHire: RequestHandler = async (req, res, next) => {
  try {
    const from = asDateFilter(req.query.fromDate, 'fromDate');
    const to = asDateFilter(req.query.toDate, 'toDate', true);

    // An inverted range is refused rather than silently returning nothing —
    // the same rule as the candidate list (D-041).
    if (from && to && from > to) {
      throw invalid('« fromDate » doit précéder « toDate ».');
    }

    const report = await timeToHireReport(req.currentUser!, from, to);
    res.status(200).json(toPublicTimeToHire(report));
  } catch (error) {
    next(error);
  }
};

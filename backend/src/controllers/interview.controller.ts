import { RequestHandler } from 'express';
import {
  scheduleInterview,
  listInterviews,
  INTERVIEW_SORT_FIELDS,
  InterviewSortField,
  DEFAULT_INTERVIEW_LIMIT,
  MAX_INTERVIEW_LIMIT,
} from '../services/interview.service';
import { toPublicInterview, toInterviewListItem } from '../views/interview.view';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/** Request-shape checks only; the business rules live in the service (Section 2). */
const asRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Le champ « ${label} » est requis.`);
  }
  return value;
};

const asRequiredDate = (value: unknown, label: string): Date => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Le champ « ${label} » est requis.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(
      `Le champ « ${label} » doit être une date et heure valides (format ISO 8601).`,
    );
  }
  return parsed;
};

/**
 * A date-only upper bound covers the WHOLE day — same rule as the candidate
 * list (D-041). `toDate=2026-08-06` at midnight would drop every interview
 * scheduled that day, and the filter would look like it worked.
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

const asBoundedInt = (
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(`« ${label} » doit être un entier positif.`);
  }
  const parsed = Number(value);
  // Refused, not clamped: see D-041.
  if (parsed < min || parsed > max) {
    throw invalid(`« ${label} » doit être compris entre ${min} et ${max}.`);
  }
  return parsed;
};

const asBooleanFlag = (value: unknown, label: string): boolean => {
  if (value === undefined) {
    return false;
  }
  // "false" is a truthy string — the classic way a boolean query flag
  // silently inverts itself.
  if (value !== 'true' && value !== 'false') {
    throw invalid(`« ${label} » doit valoir « true » ou « false ».`);
  }
  return value === 'true';
};

/** GET /api/v1/interviews — FR-33 */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const {
      interviewerId,
      jobPositionId,
      fromDate,
      toDate,
      includeCancelled,
      limit,
      offset,
      sortBy,
      sortDir,
    } = req.query;

    if (sortBy !== undefined && !INTERVIEW_SORT_FIELDS.includes(sortBy as InterviewSortField)) {
      throw invalid(`« sortBy » doit être l'un de : ${INTERVIEW_SORT_FIELDS.join(', ')}.`);
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw invalid('« sortDir » doit valoir « asc » ou « desc ».');
    }

    const from = asDateFilter(fromDate, 'fromDate');
    const to = asDateFilter(toDate, 'toDate', true);
    if (from && to && from > to) {
      throw invalid('« fromDate » doit précéder « toDate ».');
    }

    const { items, total } = await listInterviews({
      interviewerId: interviewerId === undefined ? undefined : String(interviewerId),
      jobPositionId: jobPositionId === undefined ? undefined : String(jobPositionId),
      fromDate: from,
      toDate: to,
      includeCancelled: asBooleanFlag(includeCancelled, 'includeCancelled'),
      limit: asBoundedInt(limit, 'limit', DEFAULT_INTERVIEW_LIMIT, 1, MAX_INTERVIEW_LIMIT),
      offset: asBoundedInt(offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
      sortBy: (sortBy as InterviewSortField) ?? 'scheduledAt',
      // A schedule reads forward by default, unlike the candidate list.
      sortDir: sortDir === 'desc' ? -1 : 1,
    });

    res.setHeader('X-Total-Count', total);
    res.status(200).json(items.map((i) => toInterviewListItem(i as never)));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/interviews — FR-30, FR-31, FR-32 (and FR-27 as a side effect) */
export const create: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (
      body.confirmDespiteConflict !== undefined &&
      typeof body.confirmDespiteConflict !== 'boolean'
    ) {
      throw invalid('Le champ « confirmDespiteConflict » doit être un booléen.');
    }

    const interview = await scheduleInterview(
      {
        candidateId: asRequiredString(body.candidateId, 'candidat'),
        interviewerId: asRequiredString(body.interviewerId, 'responsable hiérarchique'),
        scheduledAt: asRequiredDate(body.scheduledAt, 'date et heure'),
        confirmDespiteConflict: body.confirmDespiteConflict as boolean | undefined,
      },
      String(req.currentUser?._id),
    );

    res.status(201).json(toPublicInterview(interview));
  } catch (error) {
    next(error);
  }
};

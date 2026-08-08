import { RequestHandler } from 'express';
import {
  registerCandidate,
  listCandidates,
  CANDIDATE_SORT_FIELDS,
  CandidateSortField,
  DEFAULT_CANDIDATE_LIMIT,
  MAX_CANDIDATE_LIMIT,
  reviewCandidateCv,
  CV_REVIEW_TARGET_STAGES,
  CvReviewTargetStage,
} from '../services/candidate.service';
import { CandidateStage } from '../common/constants';
import { toCandidateListItem } from '../views/candidate.view';
import { uploadResumeForCandidate, downloadResume } from '../services/resume.service';
import { toPublicCandidate } from '../views/candidate.view';
import { toPublicResume } from '../views/resume.view';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/** Request-shape checks only; business rules live in the service (Section 2). */
const asRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Le champ « ${label} » est requis.`);
  }
  return value;
};

/** POST /api/v1/candidates — FR-19, FR-20 */
export const register: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const candidate = await registerCandidate(
      {
        fullName: asRequiredString(body.fullName, 'nom complet'),
        email: asRequiredString(body.email, 'email'),
        phone: asRequiredString(body.phone, 'téléphone'),
        jobPositionId: asRequiredString(body.jobPositionId, 'poste'),
        // Only a literal true confirms. A truthy string like "false" must not
        // wave a duplicate through (the FR-12 query-boolean trap, same class).
        confirmDuplicate: body.confirmDuplicate === true,
      },
      String(req.currentUser?._id),
    );

    res.status(201).json(toPublicCandidate(candidate));
  } catch (error) {
    next(error);
  }
};

const invalidQuery = (message: string): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message);

const asStageFilter = (value: unknown): CandidateStage | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !Object.values(CandidateStage).includes(value as CandidateStage)
  ) {
    throw invalidQuery(
      `« currentStage » doit être une étape connue : ${Object.values(CandidateStage).join(', ')}.`,
    );
  }
  return value as CandidateStage;
};

/**
 * A date-only bound is widened to cover the WHOLE day when it is the upper
 * bound. `toDate=2026-08-06` parses to midnight, so a strict `$lte` would
 * exclude every candidate registered that day — the filter would look like it
 * worked and quietly drop a day's results (FR-24, NFR-09).
 */
const asDateFilter = (value: unknown, label: string, endOfDay = false): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalidQuery(`« ${label} » doit être une date au format AAAA-MM-JJ.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidQuery(
      `« ${label} » n'est pas une date valide. Utilisez le format AAAA-MM-JJ.`,
    );
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
    throw invalidQuery(`« ${label} » doit être un entier positif.`);
  }
  const parsed = Number(value);
  // Refused rather than silently clamped: a caller asking for 500 rows should
  // be told the ceiling, not handed 100 and left to believe it got everything.
  if (parsed < min || parsed > max) {
    throw invalidQuery(`« ${label} » doit être compris entre ${min} et ${max}.`);
  }
  return parsed;
};

/** GET /api/v1/candidates — FR-24 */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const { jobPositionId, currentStage, fromDate, toDate, limit, offset, sortBy, sortDir } =
      req.query;

    if (sortBy !== undefined && !CANDIDATE_SORT_FIELDS.includes(sortBy as CandidateSortField)) {
      throw invalidQuery(`« sortBy » doit être l'un de : ${CANDIDATE_SORT_FIELDS.join(', ')}.`);
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw invalidQuery('« sortDir » doit valoir « asc » ou « desc ».');
    }

    const from = asDateFilter(fromDate, 'fromDate');
    const to = asDateFilter(toDate, 'toDate', true);
    if (from && to && from > to) {
      throw invalidQuery('« fromDate » doit précéder « toDate ».');
    }

    const { items, total } = await listCandidates({
      jobPositionId: jobPositionId === undefined ? undefined : String(jobPositionId),
      currentStage: asStageFilter(currentStage),
      fromDate: from,
      toDate: to,
      limit: asBoundedInt(limit, 'limit', DEFAULT_CANDIDATE_LIMIT, 1, MAX_CANDIDATE_LIMIT),
      offset: asBoundedInt(offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
      sortBy: (sortBy as CandidateSortField) ?? 'registeredAt',
      sortDir: sortDir === 'asc' ? 1 : -1,
    });

    // The body stays a bare array, like every other list endpoint here; the
    // match count rides in a header so pagination is usable without changing
    // the established response shape (D-041).
    res.setHeader('X-Total-Count', total);
    res.status(200).json(
      items.map(({ candidate, hasResume }) =>
        toCandidateListItem(candidate as never, hasResume),
      ),
    );
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/candidates/:id/stage — FR-25, FR-26 */
export const reviewCv: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { targetStage, rejectionReason } = body;

    // D-042: only the two stages FR-25 names are accepted here. Any other
    // value — including a real pipeline stage — is refused, so this route
    // cannot be used as the generic stage setter D-006 forbids.
    if (!CV_REVIEW_TARGET_STAGES.includes(targetStage as CvReviewTargetStage)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `« targetStage » doit valoir « ${CV_REVIEW_TARGET_STAGES.join(' » ou « ')} ».`,
      );
    }
    if (rejectionReason !== undefined && typeof rejectionReason !== 'string') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Le motif de rejet doit être une valeur texte.',
      );
    }

    const candidate = await reviewCandidateCv(
      String(req.params.id),
      { targetStage: targetStage as CvReviewTargetStage, rejectionReason },
      String(req.currentUser?._id),
    );

    res.status(200).json(toPublicCandidate(candidate));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/candidates/:id/resume — FR-21 (upload), FR-22 (replace) */
export const putResume: RequestHandler = async (req, res, next) => {
  try {
    const resume = await uploadResumeForCandidate(String(req.params.id), req.file);
    res.status(201).json(toPublicResume(resume));
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/candidates/:id/resume — FR-23 */
export const getResume: RequestHandler = async (req, res, next) => {
  try {
    // D-040: proxied, not redirected. The bytes travel back through this
    // route so the RBAC that guarded it actually governs the download.
    const { buffer, contentType, filename } = await downloadResume(
      String(req.params.id),
      req.currentUser!,
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

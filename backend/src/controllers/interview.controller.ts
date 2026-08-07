import { RequestHandler } from 'express';
import { scheduleInterview } from '../services/interview.service';
import { toPublicInterview } from '../views/interview.view';
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

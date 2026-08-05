import { RequestHandler } from 'express';
import {
  createJobPosition,
  updateJobPosition,
  closeJobPosition,
  listJobPositions,
  getJobPosition,
} from '../services/jobPosition.service';
import { toPublicJobPosition } from '../views/jobPosition.view';
import { JobPositionStatus } from '../common/constants';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/** Request-shape checks only; business rules live in the service (Section 2). */
const asRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Le champ « ${label} » est requis.`);
  }
  return value;
};

const asOptionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalid(`Le champ « ${label} » doit être une valeur texte.`);
  }
  return value;
};

const asStatus = (value: unknown, label: string): JobPositionStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !Object.values(JobPositionStatus).includes(value as JobPositionStatus)
  ) {
    throw invalid(`Le champ « ${label} » doit être un statut autorisé.`);
  }
  return value as JobPositionStatus;
};

/** POST /api/v1/job-positions — FR-14 */
export const create: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const position = await createJobPosition(
      {
        title: asRequiredString(body.title, 'intitulé'),
        departmentId: asRequiredString(body.departmentId, 'département'),
        description: asRequiredString(body.description, 'description'),
        requirements: asOptionalString(body.requirements, 'exigences'),
        status: asStatus(body.status, 'statut'),
      },
      String(req.currentUser?._id),
    );

    res.status(201).json(toPublicJobPosition(position));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/job-positions/:id — FR-15 */
export const update: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const position = await updateJobPosition(
      String(req.params.id),
      {
        title: body.title === undefined ? undefined : asRequiredString(body.title, 'intitulé'),
        departmentId:
          body.departmentId === undefined
            ? undefined
            : asRequiredString(body.departmentId, 'département'),
        description:
          body.description === undefined
            ? undefined
            : asRequiredString(body.description, 'description'),
        requirements: asOptionalString(body.requirements, 'exigences'),
        status: asStatus(body.status, 'statut'),
      },
      String(req.currentUser?._id),
    );

    res.status(200).json(toPublicJobPosition(position));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/job-positions/:id/close — FR-16 */
export const close: RequestHandler = async (req, res, next) => {
  try {
    const position = await closeJobPosition(String(req.params.id), String(req.currentUser?._id));
    res.status(200).json(toPublicJobPosition(position));
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/job-positions — FR-17 */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const { status, departmentId } = req.query;

    const positions = await listJobPositions({
      status: asStatus(status, 'statut'),
      departmentId: departmentId === undefined ? undefined : String(departmentId),
    });

    res.status(200).json(positions.map(toPublicJobPosition));
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/job-positions/:id — FR-17 */
export const getOne: RequestHandler = async (req, res, next) => {
  try {
    const position = await getJobPosition(String(req.params.id));
    res.status(200).json(toPublicJobPosition(position));
  } catch (error) {
    next(error);
  }
};

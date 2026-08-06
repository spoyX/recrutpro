import { RequestHandler } from 'express';
import { registerCandidate } from '../services/candidate.service';
import { toPublicCandidate } from '../views/candidate.view';
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

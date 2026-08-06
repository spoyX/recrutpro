import { RequestHandler } from 'express';
import { registerCandidate } from '../services/candidate.service';
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
    const { buffer, contentType, filename } = await downloadResume(String(req.params.id));

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

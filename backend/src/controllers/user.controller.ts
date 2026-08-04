import { RequestHandler } from 'express';
import {
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
  MIN_PASSWORD_LENGTH,
} from '../services/user.service';
import { toPublicUser } from '../views/user.view';
import { Role } from '../common/constants';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/**
 * Request-shape checks only — these keep non-strings out of the query layer
 * (NFR-05). Business rules (email uniqueness, whether a department may be
 * assigned) live in user.service.ts per ARCHITECTURE.md Section 2.
 */
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
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`Le champ « ${label} » doit être une valeur texte non vide.`);
  }
  return value;
};

const asRole = (value: unknown, label: string): Role => {
  if (typeof value !== 'string' || !Object.values(Role).includes(value as Role)) {
    throw invalid(`Le champ « ${label} » doit être l'un des rôles autorisés.`);
  }
  return value as Role;
};

/** POST /api/v1/users — FR-6 */
export const create: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const password = asRequiredString(body.password, 'mot de passe');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw invalid(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    }

    const user = await createUser(
      {
        name: asRequiredString(body.name, 'nom complet'),
        email: asRequiredString(body.email, 'email'),
        password,
        role: asRole(body.role, 'rôle'),
        departmentId: asOptionalString(body.departmentId, 'département'),
      },
      String(req.currentUser?._id),
    );

    res.status(201).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/users/:id — FR-7 */
export const update: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const user = await updateUser(
      String(req.params.id),
      {
        name: asOptionalString(body.name, 'nom complet'),
        role: body.role === undefined ? undefined : asRole(body.role, 'rôle'),
        departmentId: asOptionalString(body.departmentId, 'département'),
      },
      String(req.currentUser?._id),
    );

    res.status(200).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/users/:id/deactivate — FR-8 */
export const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const user = await deactivateUser(String(req.params.id), String(req.currentUser?._id));
    res.status(200).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/users/:id/reactivate — FR-9 */
export const reactivate: RequestHandler = async (req, res, next) => {
  try {
    const user = await reactivateUser(String(req.params.id), String(req.currentUser?._id));
    res.status(200).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/users/:id/reset-password — FR-10
 *
 * D-031: the generated temporary password is returned exactly once, to an
 * administrator who has already authenticated as such. It is never stored in
 * clear and never retrievable again.
 */
export const resetPassword: RequestHandler = async (req, res, next) => {
  try {
    const { user, temporaryPassword } = await resetUserPassword(
      String(req.params.id),
      String(req.currentUser?._id),
    );

    res.status(200).json({
      user: toPublicUser(user),
      temporaryPassword,
      message:
        "Communiquez ce mot de passe temporaire à l'utilisateur. Il ne sera plus affiché et devra être changé à la prochaine connexion.",
    });
  } catch (error) {
    next(error);
  }
};

import { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { User, IUser } from '../models/User.model';
import { Role } from '../common/constants';
import { AppError } from '../common/errors';

const unauthenticated = (): AppError =>
  new AppError(401, 'UNAUTHENTICATED', 'Vous devez être connecté pour accéder à cette ressource.');

const forbidden = (): AppError =>
  new AppError(403, 'FORBIDDEN', "Votre rôle ne vous autorise pas à accéder à cette ressource.");

/**
 * FR-5 / NFR-04 — every protected route starts here.
 *
 * The user is RELOADED from the database on each request rather than trusted
 * from the session (D-024 stores only userId and role). That costs one query
 * but is what makes FR-8 real: an account deactivated — or given a new role or
 * department — while logged in loses access on its very next request, instead
 * of keeping whatever was true when it signed in.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      throw unauthenticated();
    }

    const user = await User.findById(userId);

    // FR-8: the session outlived the account's right to exist. Drop it rather
    // than leaving a credential that resolves to a deactivated user.
    if (!user || !user.isActive) {
      req.session.destroy(() => undefined);
      throw unauthenticated();
    }

    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * FR-5 — role check. Must be mounted AFTER requireAuth.
 */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.currentUser;

    // Defensive: reaching here without requireAuth is a wiring mistake, and
    // must fail closed rather than wave the request through.
    if (!user) {
      next(unauthenticated());
      return;
    }

    if (!roles.includes(user.role)) {
      next(forbidden());
      return;
    }

    next();
  };

/**
 * ARCHITECTURE.md rule 2 — department scoping, enforced server-side.
 *
 * A Responsable hiérarchique may never reach data outside their own
 * department, "even via a known ID" — so this is called with the department of
 * the resource actually loaded, not with anything the client supplied.
 * Administrateur is global and Recruteur owns postings across departments
 * (FR-17, FR-45), so neither is scoped.
 *
 * Throws rather than returning a boolean: a guard that can be ignored by
 * forgetting an `if` is not a guard.
 */
export const assertDepartmentAccess = (
  user: IUser,
  resourceDepartmentId: Types.ObjectId | string | null | undefined,
): void => {
  if (user.role !== Role.ResponsableHierarchique) {
    return;
  }

  if (!user.departmentId || !resourceDepartmentId) {
    throw forbidden();
  }

  if (String(user.departmentId) !== String(resourceDepartmentId)) {
    throw forbidden();
  }
};

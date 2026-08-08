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
/**
 * Authenticates without checking mustChangePassword. Only the two routes a
 * locked-out user must still reach use this: changing their password, and
 * logging out.
 */
export const requireAuthAllowingPasswordChange: RequestHandler = async (req, _res, next) => {
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
 * FR-5 / NFR-04 — every protected route starts here.
 *
 * Also enforces FR-10: a user carrying `mustChangePassword` is refused
 * everything until they change it. The check lives HERE, in the default guard,
 * rather than as a separate middleware each router must remember to add — so a
 * router written next month is covered without anyone thinking about it.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  requireAuthAllowingPasswordChange(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    if (req.currentUser?.mustChangePassword) {
      next(
        new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Vous devez changer votre mot de passe avant de continuer.',
        ),
      );
      return;
    }

    next();
  });
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
/**
 * D-027 / D-047 — is this user restricted to their own department?
 *
 * D-027 anticipated a generic `scopeFilter(user)` returning a query fragment.
 * It is deliberately NOT that: the constraint is entity-specific (interviews
 * scope through `interviewerId` plus a two-hop join to the position's
 * department), so one generic helper would either be wrong or a bag of special
 * cases. Each list service applies its own scoping and asks this which users
 * to apply it to.
 *
 * Administrateur is global; Recruteur owns postings across departments
 * (FR-17, FR-45). Only the Responsable hiérarchique is scoped (rule 2).
 */
export const isDepartmentScoped = (user: IUser): boolean =>
  user.role === Role.ResponsableHierarchique;

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

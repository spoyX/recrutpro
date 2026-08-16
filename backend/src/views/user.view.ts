import { IUser } from '../models/User.model';
import { Role } from '../common/constants';

/**
 * The "V" of MVC (D-003): the JSON shape a User takes on the way out.
 *
 * ARCHITECTURE.md rule 3 — passwordHash is never returned in any API response.
 * It is absent here by construction rather than deleted after the fact, so a
 * new field cannot leak it by accident.
 */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  mustChangePassword: boolean;
}

/**
 * D-073 — what a Recruteur sees of a user account: exactly what FR-30's picker
 * has to render and submit, and nothing else.
 *
 * A separate shape rather than `PublicUser`, for the same reason `passwordHash`
 * is absent by construction above: `mustChangePassword` says an account is
 * sitting on an administrator-issued temporary credential, which is
 * administration business, and a field added to `PublicUser` next month would
 * otherwise reach this caller without anyone deciding that it should.
 */
export interface InterviewerOption {
  id: string;
  name: string;
  departmentId: string | null;
}

export const toInterviewerOption = (user: IUser): InterviewerOption => ({
  id: String(user._id),
  name: user.name,
  departmentId: user.departmentId ? String(user.departmentId) : null,
});

export const toPublicUser = (user: IUser): PublicUser => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  departmentId: user.departmentId ? String(user.departmentId) : null,
  // FR-10: the client needs this to force the password-change flow.
  mustChangePassword: user.mustChangePassword,
});

/**
 * D-084 — FR-8 / FR-9 / FR-12: what the ADMINISTRATION screen sees.
 *
 * `PublicUser` plus `isActive`, and a separate shape for the reason the
 * `InterviewerOption` note above already gives: widening `PublicUser` reaches
 * every caller, and two of them are login and `/auth/me`. `auth.spec.ts`
 * asserts the login response's exact field set AND, in as many words, that it
 * carries no `isActive` — three tests that exist to pin that contract. Loosening
 * them to suit an admin list would be changing a guard to fit the thing it
 * guards against.
 *
 * It is also correct on its own terms: a user reading their OWN record is
 * active by definition, since a deactivated account cannot authenticate
 * (D-027), so the flag would be noise there and is load-bearing only here.
 *
 * NOT a new database field and NOT a new route — `isActive` has been on the
 * User model since the beginning (ARCHITECTURE.md Section 7) and `GET /users`
 * has always accepted it as a FILTER. Only the response omitted it, while
 * `PublicDepartment` has carried the same flag all along.
 */
export interface AdminUser extends PublicUser {
  isActive: boolean;
}

export const toAdminUser = (user: IUser): AdminUser => ({
  ...toPublicUser(user),
  // FR-8 / FR-9: which of the two actions this row may offer.
  isActive: user.isActive,
});

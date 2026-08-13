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

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

export const toPublicUser = (user: IUser): PublicUser => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  departmentId: user.departmentId ? String(user.departmentId) : null,
  // FR-10: the client needs this to force the password-change flow.
  mustChangePassword: user.mustChangePassword,
});

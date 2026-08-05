import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import { Types } from 'mongoose';
import { User, IUser } from '../models/User.model';
import { Department } from '../models/Department.model';
import { Role, AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';

const BCRYPT_COST = 10;

/** No length is specified anywhere in the SRS; see D-029. */
export const MIN_PASSWORD_LENGTH = 8;

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', "Cet utilisateur n'existe pas.");

const findUserOr404 = async (id: string): Promise<IUser> => {
  // A malformed id is a miss, not a 500 from the ObjectId cast.
  if (!Types.ObjectId.isValid(id)) {
    throw notFound();
  }

  const user = await User.findById(id);
  if (!user) {
    throw notFound();
  }
  return user;
};

/**
 * A department is only assignable if it exists AND is still active.
 *
 * FR-13 says a deactivated department disappears from selection lists — that
 * is a UI statement, but NFR-04 forbids relying on the client for it, so the
 * rule is enforced here as well. Administrateur is global and carries no
 * department (D-016).
 */
const assertAssignableDepartment = async (
  role: Role,
  departmentId: string | undefined,
): Promise<void> => {
  if (role === Role.Administrateur) {
    return;
  }

  if (!departmentId || !Types.ObjectId.isValid(departmentId)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Un département valide est requis pour ce rôle. Sélectionnez-en un dans la liste.',
    );
  }

  const department = await Department.findById(departmentId);
  if (!department || !department.isActive) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "Ce département n'existe pas ou a été désactivé. Choisissez un département actif.",
    );
  }
};

export interface UserFilters {
  role?: Role;
  isActive?: boolean;
}

/**
 * FR-12 — list all users, filterable by role and by active status.
 *
 * No pagination: NFR-01 caps the system at ~50 concurrent users, so the whole
 * table is a handful of documents. Add it when a real deployment says otherwise.
 */
export const listUsers = async (filters: UserFilters): Promise<IUser[]> => {
  const query: Record<string, unknown> = {};

  if (filters.role !== undefined) {
    query.role = filters.role;
  }
  if (filters.isActive !== undefined) {
    query.isActive = filters.isActive;
  }

  // Sorted by name so the admin screen has a stable order between reloads.
  return User.find(query).sort({ name: 1 });
};

/** FR-12 — read a single user. */
export const getUserById = async (id: string): Promise<IUser> => findUserOr404(id);

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  departmentId?: string;
}

/** FR-6 — create an account. */
export const createUser = async (input: CreateUserInput, actorId: string): Promise<IUser> => {
  const email = input.email.toLowerCase().trim();

  // Accounts are keyed by email (unlike candidates, D-004): a duplicate is a
  // conflict to report, never a silent overwrite of someone's access.
  if (await User.exists({ email })) {
    throw new AppError(
      409,
      'EMAIL_ALREADY_EXISTS',
      'Un compte existe déjà avec cette adresse email. Utilisez une autre adresse.',
    );
  }

  await assertAssignableDepartment(input.role, input.departmentId);

  const user = await User.create({
    name: input.name.trim(),
    email,
    passwordHash: await hash(input.password, BCRYPT_COST),
    role: input.role,
    departmentId: input.departmentId,
    isActive: true,
    // D-029: the administrator chose this password, so it must not stay the
    // user's long-term secret. Same forced-change mechanism FR-10 describes.
    mustChangePassword: true,
  });

  // FR-11 / rule 4
  await recordAudit({
    userId: actorId,
    action: AuditAction.UtilisateurCree,
    targetType: AuditTargetType.User,
    targetId: user._id as Types.ObjectId,
  });

  return user;
};

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  departmentId?: string;
}

/**
 * FR-7 — edit name, role and department. Email is deliberately NOT editable:
 * FR-7 lists the three fields above, and email is the login identifier.
 */
export const updateUser = async (
  id: string,
  changes: UpdateUserInput,
  actorId: string,
): Promise<IUser> => {
  const user = await findUserOr404(id);

  const nextRole = changes.role ?? user.role;
  const nextDepartmentId =
    changes.departmentId ?? (user.departmentId ? String(user.departmentId) : undefined);

  // Re-validate whenever either side of the role/department pair moves: a
  // Recruteur promoted to Administrateur no longer needs one, and an
  // Administrateur demoted to Recruteur suddenly does.
  if (changes.role !== undefined || changes.departmentId !== undefined) {
    await assertAssignableDepartment(nextRole, nextDepartmentId);
  }

  if (changes.name !== undefined) {
    user.name = changes.name.trim();
  }
  if (changes.role !== undefined) {
    user.role = changes.role;
  }
  if (changes.departmentId !== undefined) {
    user.departmentId = new Types.ObjectId(changes.departmentId);
  }

  // An Administrateur is global; leaving a stale department on one would make
  // the scoping rules ambiguous (D-016, rule 2).
  if (user.role === Role.Administrateur) {
    user.departmentId = undefined;
  }

  await user.save();

  // FR-11 / rule 4
  await recordAudit({
    userId: actorId,
    action: AuditAction.UtilisateurModifie,
    targetType: AuditTargetType.User,
    targetId: user._id as Types.ObjectId,
  });

  return user;
};

/**
 * FR-8 — deactivate. The account keeps its history; only access is revoked.
 * requireAuth reloads the user on every request (D-027), so an active session
 * belonging to this account stops working immediately, not at session expiry.
 */
export const deactivateUser = async (id: string, actorId: string): Promise<IUser> => {
  // D-029: not in any FR, but an administrator who deactivates themselves is
  // locked out of the only role that could undo it.
  if (id === actorId) {
    throw new AppError(
      400,
      'CANNOT_DEACTIVATE_SELF',
      'Vous ne pouvez pas désactiver votre propre compte. Demandez à un autre administrateur.',
    );
  }

  const user = await findUserOr404(id);
  user.isActive = false;
  await user.save();

  // FR-11 / rule 4
  await recordAudit({
    userId: actorId,
    action: AuditAction.UtilisateurDesactive,
    targetType: AuditTargetType.User,
    targetId: user._id as Types.ObjectId,
  });

  return user;
};

/** FR-9 — restore access to a previously deactivated account. */
export const reactivateUser = async (id: string, actorId: string): Promise<IUser> => {
  const user = await findUserOr404(id);
  user.isActive = true;
  await user.save();

  // FR-11 / rule 4
  await recordAudit({
    userId: actorId,
    action: AuditAction.UtilisateurReactive,
    targetType: AuditTargetType.User,
    targetId: user._id as Types.ObjectId,
  });

  return user;
};

/**
 * A temporary credential, not a memorable password: 16 url-safe characters
 * from the CSPRNG. Comfortably above MIN_PASSWORD_LENGTH and not guessable.
 */
const generateTemporaryPassword = (): string => randomBytes(12).toString('base64url');

export interface PasswordResetResult {
  user: IUser;
  /** Returned to the requesting administrator ONCE. Never stored in clear. See D-031. */
  temporaryPassword: string;
}

/**
 * FR-10 — reset a user's password.
 *
 * The plaintext is generated here, hashed immediately, and handed back exactly
 * once so the administrator can pass it on (there is no email channel — PRD
 * Section 6). It is never persisted in a retrievable form. `mustChangePassword`
 * makes it single-use in practice: requireAuth refuses every other route until
 * the user replaces it.
 */
export const resetUserPassword = async (
  id: string,
  actorId: string,
): Promise<PasswordResetResult> => {
  const user = await findUserOr404(id);

  const temporaryPassword = generateTemporaryPassword();
  user.passwordHash = await hash(temporaryPassword, BCRYPT_COST);
  user.mustChangePassword = true;
  await user.save();

  // FR-11 / rule 4 — the entry records THAT a reset happened, never the value.
  await recordAudit({
    userId: actorId,
    action: AuditAction.MotDePasseReinitialise,
    targetType: AuditTargetType.User,
    targetId: user._id as Types.ObjectId,
  });

  return { user, temporaryPassword };
};

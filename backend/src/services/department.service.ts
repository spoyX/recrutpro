import { Types } from 'mongoose';
import { Department, IDepartment } from '../models/Department.model';
import { AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';

const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', "Ce département n'existe pas.");

const nameTaken = (): AppError =>
  new AppError(
    409,
    'DEPARTMENT_NAME_TAKEN',
    'Un département porte déjà ce nom. Choisissez un autre intitulé.',
  );

const findDepartmentOr404 = async (id: string): Promise<IDepartment> => {
  if (!Types.ObjectId.isValid(id)) {
    throw notFound();
  }

  const department = await Department.findById(id);
  if (!department) {
    throw notFound();
  }
  return department;
};

/**
 * FR-13 — list departments.
 *
 * Active-only by default: FR-13 says a deactivated department "n'apparaît plus
 * dans les listes de choix", and this list is what feeds those pickers.
 * `includeInactive` exists so the administration screen can still see and
 * reactivate them — D-035.
 */
export const listDepartments = async (includeInactive: boolean): Promise<IDepartment[]> =>
  Department.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 });

/** FR-13 — create. */
export const createDepartment = async (name: string, actorId: string): Promise<IDepartment> => {
  const trimmed = name.trim();

  // Department.name is uniquely indexed (D-016); checking first turns a driver
  // duplicate-key error into the documented 409.
  if (await Department.exists({ name: trimmed })) {
    throw nameTaken();
  }

  const department = await Department.create({ name: trimmed, isActive: true });

  await recordAudit({
    userId: actorId,
    action: AuditAction.DepartementCree,
    targetType: AuditTargetType.Department,
    targetId: department._id as Types.ObjectId,
  });

  return department;
};

/** FR-13 — rename. */
export const renameDepartment = async (
  id: string,
  name: string,
  actorId: string,
): Promise<IDepartment> => {
  const department = await findDepartmentOr404(id);
  const trimmed = name.trim();

  // Exclude self, so renaming to the same value is a no-op rather than a 409.
  const clash = await Department.exists({ name: trimmed, _id: { $ne: department._id } });
  if (clash) {
    throw nameTaken();
  }

  department.name = trimmed;
  await department.save();

  await recordAudit({
    userId: actorId,
    action: AuditAction.DepartementModifie,
    targetType: AuditTargetType.Department,
    targetId: department._id as Types.ObjectId,
  });

  return department;
};

/**
 * FR-13 — deactivate. A flag, never a delete: "l'historique est conservé", and
 * users and job positions still reference it.
 */
export const deactivateDepartment = async (
  id: string,
  actorId: string,
): Promise<IDepartment> => {
  const department = await findDepartmentOr404(id);
  department.isActive = false;
  await department.save();

  await recordAudit({
    userId: actorId,
    action: AuditAction.DepartementDesactive,
    targetType: AuditTargetType.Department,
    targetId: department._id as Types.ObjectId,
  });

  return department;
};

/** Reactivate — see D-035: requested by the human, absent from FR-13 and Section 9. */
export const reactivateDepartment = async (
  id: string,
  actorId: string,
): Promise<IDepartment> => {
  const department = await findDepartmentOr404(id);
  department.isActive = true;
  await department.save();

  await recordAudit({
    userId: actorId,
    action: AuditAction.DepartementReactive,
    targetType: AuditTargetType.Department,
    targetId: department._id as Types.ObjectId,
  });

  return department;
};

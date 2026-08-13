import { Types } from 'mongoose';
import { JobPosition, IJobPosition } from '../models/JobPosition.model';
import { Department } from '../models/Department.model';
import { JobPositionStatus, AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';

const notFound = (): AppError => new AppError(404, 'NOT_FOUND', "Ce poste n'existe pas.");

const findPositionOr404 = async (id: string): Promise<IJobPosition> => {
  if (!Types.ObjectId.isValid(id)) {
    throw notFound();
  }

  const position = await JobPosition.findById(id);
  if (!position) {
    throw notFound();
  }
  return position;
};

/**
 * The department a position points at must exist AND be active — same rule as
 * user assignment (D-030). FR-14 says the department is "choisi dans une
 * liste", and FR-13 keeps deactivated ones out of that list; NFR-04 forbids
 * trusting the client to have honoured it.
 */
const assertAssignableDepartment = async (departmentId: string): Promise<void> => {
  if (!Types.ObjectId.isValid(departmentId)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Un département valide est requis. Sélectionnez-en un dans la liste.',
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

export interface CreateJobPositionInput {
  title: string;
  departmentId: string;
  description: string;
  requirements?: string;
  status?: JobPositionStatus;
}

/** FR-14 — create a position. */
export const createJobPosition = async (
  input: CreateJobPositionInput,
  actorId: string,
): Promise<IJobPosition> => {
  await assertAssignableDepartment(input.departmentId);

  // D-037: FR-14 offers Ouvert or Brouillon only. Clôturé is reachable solely
  // through the FR-16 close action — a terminal state is a side effect of an
  // action, never a value a client may assign (the Section 8 principle).
  const status = input.status ?? JobPositionStatus.Brouillon;
  if (status === JobPositionStatus.Cloture) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "Un poste ne peut pas être créé avec le statut « Clôturé ». Utilisez l'action de clôture.",
    );
  }

  const position = await JobPosition.create({
    title: input.title.trim(),
    department: input.departmentId,
    description: input.description.trim(),
    requirements: input.requirements?.trim(),
    status,
    // createdAt is schema-defaulted and immutable (FR-14, FR-15).
    // D-052: routing target for FR-40/FR-41 notifications, never an ACL.
    createdBy: actorId,
  });

  // FR-11 / rule 4 / D-036
  await recordAudit({
    userId: actorId,
    action: AuditAction.PosteCree,
    targetType: AuditTargetType.JobPosition,
    targetId: position._id as Types.ObjectId,
  });

  return position;
};

export interface UpdateJobPositionInput {
  title?: string;
  departmentId?: string;
  description?: string;
  requirements?: string;
  status?: JobPositionStatus;
}

/**
 * FR-15 — edit every field except the creation date.
 *
 * D-037: "un poste ouvert" is read as "not closed" — Brouillon and Ouvert are
 * editable, Clôturé is not. A draft that could never be edited into an open
 * posting would make FR-14's Brouillon status pointless.
 */
export const updateJobPosition = async (
  id: string,
  changes: UpdateJobPositionInput,
  actorId: string,
): Promise<IJobPosition> => {
  const position = await findPositionOr404(id);

  if (position.status === JobPositionStatus.Cloture) {
    throw new AppError(
      409,
      'POSITION_CLOSED',
      "Ce poste est clôturé et ne peut plus être modifié. Rouvrez un nouveau poste si nécessaire.",
    );
  }

  if (changes.status === JobPositionStatus.Cloture) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "Utilisez l'action de clôture pour clôturer un poste.",
    );
  }

  if (changes.departmentId !== undefined) {
    await assertAssignableDepartment(changes.departmentId);
    position.department = new Types.ObjectId(changes.departmentId);
  }
  if (changes.title !== undefined) {
    position.title = changes.title.trim();
  }
  if (changes.description !== undefined) {
    position.description = changes.description.trim();
  }
  if (changes.requirements !== undefined) {
    position.requirements = changes.requirements.trim();
  }
  if (changes.status !== undefined) {
    position.status = changes.status;
  }

  await position.save();

  // FR-11 / rule 4 / D-036
  await recordAudit({
    userId: actorId,
    action: AuditAction.PosteModifie,
    targetType: AuditTargetType.JobPosition,
    targetId: position._id as Types.ObjectId,
  });

  return position;
};

/**
 * FR-16 — close a position. Blocks new candidates from being attached to it;
 * that half is enforced by `assertAcceptsCandidates` below, called from
 * candidate registration (FR-19).
 */
export const closeJobPosition = async (id: string, actorId: string): Promise<IJobPosition> => {
  const position = await findPositionOr404(id);

  // Idempotent would hide a double-click, but re-closing is also not an error
  // worth failing a workflow over — report it plainly instead.
  if (position.status === JobPositionStatus.Cloture) {
    throw new AppError(409, 'POSITION_ALREADY_CLOSED', 'Ce poste est déjà clôturé.');
  }

  position.status = JobPositionStatus.Cloture;
  await position.save();

  // FR-11 / rule 4 / D-036
  await recordAudit({
    userId: actorId,
    action: AuditAction.PosteCloture,
    targetType: AuditTargetType.JobPosition,
    targetId: position._id as Types.ObjectId,
  });

  return position;
};

export interface JobPositionFilters {
  status?: JobPositionStatus;
  departmentId?: string;
}

/** FR-17 — list, filterable by status and department. */
export const listJobPositions = async (
  filters: JobPositionFilters,
): Promise<IJobPosition[]> => {
  const query: Record<string, unknown> = {};

  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.departmentId) {
    if (!Types.ObjectId.isValid(filters.departmentId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de département invalide.');
    }
    query.department = filters.departmentId;
  }

  // `_id` tiebreaker, same reasoning as D-069 but a WEAKER case, recorded so
  // the difference is clear: this list is UNPAGINATED, so an unstable sort
  // could never duplicate or drop a row here — it could only reshuffle
  // positions sharing a `createdAt` between one load and the next, which is
  // reachable whenever several are seeded together. One line buys a
  // deterministic order for the FR-17 list and the FR-24 poste picker.
  // (`Department.name` is unique per D-016, so that list cannot tie at all
  // and was deliberately left alone.)
  return JobPosition.find(query).sort({ createdAt: -1, _id: 1 });
};

/** FR-17 — read one. */
export const getJobPosition = (id: string): Promise<IJobPosition> => findPositionOr404(id);

/**
 * FR-16, second half — the rule a closed position enforces.
 *
 * Exported for candidate registration (FR-19) to call before attaching a
 * candidate. Defined here because it is a job-position rule, not a candidate
 * one, and putting it here means FR-19 cannot forget it exists.
 */
export const assertAcceptsCandidates = async (jobPositionId: string): Promise<IJobPosition> => {
  const position = await findPositionOr404(jobPositionId);

  if (position.status === JobPositionStatus.Cloture) {
    throw new AppError(
      409,
      'POSITION_CLOSED',
      "Ce poste est clôturé : aucun nouveau candidat ne peut y être rattaché.",
    );
  }

  return position;
};

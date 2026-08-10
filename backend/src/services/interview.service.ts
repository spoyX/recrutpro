import { Types } from 'mongoose';
import { Interview, IInterview } from '../models/Interview.model';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { JobPosition } from '../models/JobPosition.model';
import { Resume } from '../models/Resume.model';
import { User, IUser } from '../models/User.model';
import { isDepartmentScoped } from '../middleware/rbac.middleware';
import {
  CandidateStage,
  InterviewStatus,
  Role,
  AuditAction,
  AuditTargetType,
} from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';
import { markInterviewScheduled, revertToPreselection } from './candidate.service';

/** FR-31 / D-005 — 30 minutes before and after the requested slot. */
export const CONFLICT_BUFFER_MS = 30 * 60 * 1000;

const candidateNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");

/**
 * FR-30 — the interviewer must be an active Responsable hiérarchique
 * belonging to the department of the CANDIDATE'S JOB POSITION.
 *
 * The department is resolved server-side from the position, never taken from
 * the request: NFR-04, and the same reasoning as D-030 — a constrained picker
 * is not an enforced rule.
 */
const assertEligibleInterviewer = async (
  interviewerId: string,
  jobPositionDepartmentId: Types.ObjectId,
): Promise<void> => {
  if (!Types.ObjectId.isValid(interviewerId)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Un responsable hiérarchique valide est requis. Sélectionnez-en un dans la liste.',
    );
  }

  const interviewer = await User.findById(interviewerId);

  // One message for every failure mode: wrong role, inactive, wrong
  // department or nonexistent all state the same corrective action (NFR-09),
  // and none of them should let a caller probe the user directory.
  if (
    !interviewer ||
    !interviewer.isActive ||
    interviewer.role !== Role.ResponsableHierarchique ||
    String(interviewer.departmentId) !== String(jobPositionDepartmentId)
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "L'intervenant choisi doit être un responsable hiérarchique actif du département du poste. Choisissez-en un dans la liste proposée.",
    );
  }
};

/**
 * FR-31 / FR-32 / D-005 — find an existing interview for the same interviewer
 * whose slot falls within 30 minutes either side of the requested one.
 *
 * Cancelled interviews are ignored: they no longer occupy the slot, and
 * counting them would raise a phantom conflict that no rescheduling could
 * ever clear (D-043).
 */
export const findConflictingInterview = (
  interviewerId: string,
  scheduledAt: Date,
): Promise<IInterview | null> =>
  Interview.findOne({
    interviewerId,
    status: InterviewStatus.Planifie,
    scheduledAt: {
      $gte: new Date(scheduledAt.getTime() - CONFLICT_BUFFER_MS),
      $lte: new Date(scheduledAt.getTime() + CONFLICT_BUFFER_MS),
    },
  }).populate('candidateId', 'fullName');

export interface ScheduleInterviewInput {
  candidateId: string;
  interviewerId: string;
  scheduledAt: Date;
  /** FR-32: the recruiter's explicit "book it anyway" after a conflict warning. */
  confirmDespiteConflict?: boolean;
}

/**
 * FR-30 to FR-32 — schedule an interview, with conflict detection.
 *
 * FR-27: on success the candidate moves to « Entretien planifié », as a side
 * effect of this action and never as a directly settable value (D-006).
 */
export const scheduleInterview = async (
  input: ScheduleInterviewInput,
  actorId: string,
): Promise<IInterview> => {
  if (!Types.ObjectId.isValid(input.candidateId)) {
    throw candidateNotFound();
  }

  const candidate: ICandidate | null = await Candidate.findById(input.candidateId);
  if (!candidate) {
    throw candidateNotFound();
  }

  // FR-30: only a CV-validated candidate can be scheduled. Checked before the
  // interviewer, so an ineligible candidate never causes a user lookup.
  if (candidate.currentStage !== CandidateStage.PreselectionCvValidee) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `Un entretien ne peut être planifié que pour un candidat à l'étape ` +
        `« ${CandidateStage.PreselectionCvValidee} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} ».`,
    );
  }

  // D-043: an interview is a future event, and the common data-entry error is
  // a mistyped year. Flagged as the one invented rule in this module.
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "La date de l'entretien doit être dans le futur. Corrigez la date et l'heure.",
    );
  }

  const position = await JobPosition.findById(candidate.jobPositionId);
  if (!position) {
    throw new AppError(
      404,
      'NOT_FOUND',
      "Le poste rattaché à ce candidat est introuvable.",
    );
  }

  await assertEligibleInterviewer(input.interviewerId, position.department);

  // FR-31 / FR-32: a warning with an explicit override, never a hard block.
  if (input.confirmDespiteConflict !== true) {
    const conflict = await findConflictingInterview(input.interviewerId, input.scheduledAt);
    if (conflict) {
      const other = conflict.candidateId as unknown as { fullName?: string } | null;
      const when = conflict.scheduledAt.toISOString().replace('T', ' à ').slice(0, 19);
      throw new AppError(
        409,
        'SCHEDULING_CONFLICT',
        `Ce responsable a déjà un entretien proche de ce créneau : ` +
          `${other?.fullName ?? 'un autre candidat'}, le ${when} (UTC). ` +
          `Choisissez un autre créneau, ou renvoyez la demande avec ` +
          `« confirmDespiteConflict » à true pour confirmer malgré le conflit.`,
      );
    }
  }

  const interview = await Interview.create({
    candidateId: candidate._id,
    interviewerId: input.interviewerId,
    scheduledAt: input.scheduledAt,
    status: InterviewStatus.Planifie,
  });

  // FR-11 / rule 4 / D-044 — scheduling is audited in its own right. Rule 4
  // names only cancellation; extended by human decision, as D-034 and D-036
  // did. Distinct from the stage-change entry below: two facts, two entities,
  // so an auditor filtering by targetType finds each under its own.
  await recordAudit({
    userId: actorId,
    action: AuditAction.EntretienPlanifie,
    targetType: AuditTargetType.Interview,
    targetId: interview._id as Types.ObjectId,
  });

  // FR-27 — the stage change is a side effect of THIS action (D-006). It also
  // writes the rule-4 audit entry for the stage change.
  await markInterviewScheduled(candidate, actorId);

  // TODO(FR-42): notify the interviewer that an interview was scheduled for
  // them. Notifications module not built yet — sweep with the TODO(FR-40)
  // sites. See D-043.

  return interview;
};

/**
 * FR-34 — cancel a planned interview.
 *
 * The motive is enforced HERE, not left to the schema's conditional `required`
 * (D-016). That rule is a backstop: leaning on it would surface a Mongoose
 * ValidationError as a generic 400 (D-020) and lose both the specific error
 * code and the NFR-09 wording telling the recruiter what to do.
 */
export const cancelInterview = async (
  interviewId: string,
  cancellationReason: string | undefined,
  actorId: string,
): Promise<IInterview> => {
  if (!Types.ObjectId.isValid(interviewId)) {
    throw new AppError(404, 'NOT_FOUND', "Cet entretien n'existe pas.");
  }

  const interview = await Interview.findById(interviewId);
  if (!interview) {
    throw new AppError(404, 'NOT_FOUND', "Cet entretien n'existe pas.");
  }

  // Checked BEFORE the motive, so an already-cancelled interview reports the
  // real problem rather than complaining about a missing reason.
  if (interview.status !== InterviewStatus.Planifie) {
    throw new AppError(
      409,
      'INTERVIEW_NOT_CANCELLABLE',
      `Seul un entretien au statut « ${InterviewStatus.Planifie} » peut être annulé. ` +
        `Celui-ci est au statut « ${interview.status} ».`,
    );
  }

  const reason = cancellationReason?.trim();
  if (!reason) {
    throw new AppError(
      400,
      'CANCELLATION_REASON_REQUIRED',
      "Un motif d'annulation est obligatoire. Saisissez-le et renvoyez la demande.",
    );
  }

  const candidate = await Candidate.findById(interview.candidateId);
  if (!candidate) {
    throw new AppError(404, 'NOT_FOUND', "Le candidat de cet entretien n'existe plus.");
  }

  // D-046: the revert is gated, and the gate is checked BEFORE anything is
  // written. Checking it only inside revertToPreselection would cancel the
  // interview first and then throw, leaving a cancelled interview behind a
  // failed request. FR-34 states the revert as part of what cancelling IS, so
  // either both happen or neither does.
  if (candidate.currentStage !== CandidateStage.EntretienPlanifie) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `Ce candidat est à l'étape « ${candidate.currentStage} » et ne peut plus revenir à ` +
        `« ${CandidateStage.PreselectionCvValidee} ». L'entretien n'a pas été annulé.`,
    );
  }

  interview.status = InterviewStatus.Annule;
  interview.cancellationReason = reason;
  await interview.save();

  // FR-11 / rule 4 — cancellation is named explicitly in rule 4's list, so
  // unlike scheduling (D-044) this needs no extension of the rule.
  await recordAudit({
    userId: actorId,
    action: AuditAction.EntretienAnnule,
    targetType: AuditTargetType.Interview,
    targetId: interview._id as Types.ObjectId,
  });

  // FR-34 — the candidate returns to « Présélection CV validée ». Writes the
  // second, separately-required audit entry against the Candidate (D-046).
  await revertToPreselection(candidate, actorId);

  return interview;
};

/**
 * FR-35 / D-047 — may this user reach this candidate's file?
 *
 * A Responsable hiérarchique may, but ONLY for a candidate they are actually
 * interviewing, and only while the department floor holds. Deliberately the
 * same predicate the FR-35 list applies, so a CV is reachable for exactly the
 * interviews the caller can see and no others.
 *
 * Cancelled interviews still grant access: the Responsable may legitimately
 * need to review a file for an interview that was called off, and hiding the
 * CV would not hide the candidate's existence anyway.
 */
export const hasAssignedInterviewWith = async (
  viewer: IUser,
  candidate: ICandidate,
): Promise<boolean> => {
  const position = await JobPosition.findById(candidate.jobPositionId, 'department');
  if (!position || String(position.department) !== String(viewer.departmentId)) {
    return false;
  }

  const assigned = await Interview.exists({
    candidateId: candidate._id,
    interviewerId: viewer._id,
  });
  return Boolean(assigned);
};

/** FR-33 — the only sortable columns. Anything else is refused, not ignored. */
export const INTERVIEW_SORT_FIELDS = ['scheduledAt', 'status'] as const;
export type InterviewSortField = (typeof INTERVIEW_SORT_FIELDS)[number];

export const DEFAULT_INTERVIEW_LIMIT = 25;
export const MAX_INTERVIEW_LIMIT = 100;

export interface ListInterviewsInput {
  interviewerId?: string;
  jobPositionId?: string;
  fromDate?: Date;
  toDate?: Date;
  /** D-049: covers every non-`Planifié` status — cancelled AND completed. */
  includeFinished: boolean;
  limit: number;
  offset: number;
  sortBy: InterviewSortField;
  sortDir: 1 | -1;
  /** The authenticated caller. FR-35 scoping is derived from this, never from the query. */
  viewer: IUser;
}

export interface ListInterviewsResult {
  items: Array<{ interview: IInterview; hasResume: boolean }>;
  total: number;
}

/**
 * FR-33 — the recruiter's interview list, filterable by date, responsable
 * hiérarchique and poste. The same data backs a calendar view; that rendering
 * is frontend work.
 *
 * D-045: `Planifié` only by default. FR-33 asks for « les entretiens
 * planifiés », and a schedule padded with cancelled slots would misrepresent
 * the interviewer's real load. `includeFinished` reaches the history that
 * FR-34 (cancellation) and D-048 (evaluation) deliberately preserve.
 */
export const listInterviews = async (
  input: ListInterviewsInput,
): Promise<ListInterviewsResult> => {
  const query: Record<string, unknown> = {};

  // D-045 as amended by D-049: the default is the OPEN schedule — only
  // `Planifié`. That hides cancelled interviews and, since D-048 introduced
  // `Réalisé`, completed ones too, which is why the flag is named for what it
  // actually does rather than for cancellation alone.
  if (!input.includeFinished) {
    query.status = InterviewStatus.Planifie;
  }

  if (input.interviewerId) {
    if (!Types.ObjectId.isValid(input.interviewerId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de responsable invalide.');
    }
    query.interviewerId = input.interviewerId;
  }

  // FR-35 / D-047 — scoping. A Responsable asking for someone else's
  // interviews is REFUSED, not silently handed their own: overwriting the
  // filter is safe but returns a confidently wrong answer, the same
  // silent-wrong-result this codebase refuses everywhere else (D-041).
  const scoped = isDepartmentScoped(input.viewer);
  if (scoped) {
    if (input.interviewerId && input.interviewerId !== String(input.viewer._id)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Vous ne pouvez consulter que les entretiens qui vous sont assignés. Retirez le filtre « interviewerId » ou indiquez le vôtre.',
      );
    }
    query.interviewerId = input.viewer._id;
  }

  // D-045: Interview holds candidateId and the position lives on the
  // Candidate, so filtering by poste resolves candidate ids first. D-047 adds
  // rule 2's department floor through the same join — redundant with the
  // interviewerId clause while FR-30 holds, but not after a Responsable is
  // moved to another department.
  if (input.jobPositionId || scoped) {
    const positionFilter: Record<string, unknown> = {};
    if (input.jobPositionId) {
      if (!Types.ObjectId.isValid(input.jobPositionId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de poste invalide.');
      }
      positionFilter._id = input.jobPositionId;
    }
    if (scoped) {
      positionFilter.department = input.viewer.departmentId;
    }

    const positions = await JobPosition.find(positionFilter, '_id');
    const candidateIds = await Candidate.find(
      { jobPositionId: { $in: positions.map((p) => p._id) } },
      '_id',
    );
    query.candidateId = { $in: candidateIds.map((c) => c._id) };
  }

  if (input.fromDate || input.toDate) {
    const range: Record<string, Date> = {};
    if (input.fromDate) {
      range.$gte = input.fromDate;
    }
    if (input.toDate) {
      range.$lte = input.toDate;
    }
    query.scheduledAt = range;
  }

  // Counted against the SAME filter, before pagination.
  const total = await Interview.countDocuments(query);

  const items = await Interview.find(query)
    .populate({
      path: 'candidateId',
      select: 'fullName jobPositionId',
      populate: { path: 'jobPositionId', select: 'title' },
    })
    .populate('interviewerId', 'name')
    .sort({ [input.sortBy]: input.sortDir })
    .skip(input.offset)
    .limit(input.limit);

  // FR-35 « un accès au CV » — one query for the whole page, not one per row,
  // same shape as the FR-24 candidate list.
  const candidateIdsOnPage = items
    .map((i) => (i.candidateId as unknown as { _id?: Types.ObjectId })?._id)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const withResume = await Resume.find(
    { candidateId: { $in: candidateIdsOnPage }, isActive: true },
    'candidateId',
  );
  const resumeOwners = new Set(withResume.map((r) => String(r.candidateId)));

  return {
    total,
    items: items.map((interview) => ({
      interview,
      hasResume: resumeOwners.has(
        String((interview.candidateId as unknown as { _id?: unknown })?._id),
      ),
    })),
  };
};

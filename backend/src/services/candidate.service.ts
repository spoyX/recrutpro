import { Types } from 'mongoose';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { Resume } from '../models/Resume.model';
import { CandidateStage, AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';
import { assertAcceptsCandidates } from './jobPosition.service';

export interface RegisterCandidateInput {
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: string;
  /** FR-20: the recruiter's explicit "yes, create it anyway" after a warning. */
  confirmDuplicate?: boolean;
}

/**
 * FR-20 / D-004 — duplicate detection is scoped to (email + jobPositionId),
 * never to email alone: the same person applying to a second position is
 * normal recruitment behaviour and must not be blocked.
 *
 * This is a WARNING with an override, not a hard block. The first attempt is
 * refused with a message naming the existing record; resending with
 * confirmDuplicate creates the candidate regardless.
 */
const assertNoUnconfirmedDuplicate = async (
  email: string,
  jobPositionId: string,
  confirmed: boolean,
): Promise<void> => {
  if (confirmed) {
    return;
  }

  const existing = await Candidate.findOne({ email, jobPositionId });
  if (!existing) {
    return;
  }

  // The Section 9 error shape is {error:{code,message}} with no room for extra
  // fields, so the detail FR-20 requires ("le détail du doublon") travels in
  // the message — along with the corrective action, per NFR-09.
  const registeredOn = existing.registeredAt.toISOString().slice(0, 10);
  throw new AppError(
    409,
    'DUPLICATE_CANDIDATE',
    `Un candidat avec l'adresse ${email} est déjà enregistré sur ce poste ` +
      `(${existing.fullName}, enregistré le ${registeredOn}). Renvoyez la demande ` +
      `avec « confirmDuplicate » à true pour créer le doublon volontairement, ` +
      `ou annulez.`,
  );
};

/** FR-19 — register a candidate. The initial stage is fixed, never supplied. */
export const registerCandidate = async (
  input: RegisterCandidateInput,
  actorId: string,
): Promise<ICandidate> => {
  // FR-16, second half: a closed position accepts no new candidate. Checked
  // FIRST — if the position is closed the duplicate question is moot, and this
  // also 404s an unknown position before anything else runs.
  await assertAcceptsCandidates(input.jobPositionId);

  const email = input.email.trim().toLowerCase();

  await assertNoUnconfirmedDuplicate(email, input.jobPositionId, input.confirmDuplicate === true);

  return Candidate.create({
    fullName: input.fullName.trim(),
    email,
    phone: input.phone.trim(),
    jobPositionId: input.jobPositionId,
    // FR-19: "l'étape initiale est automatiquement « Candidature reçue »".
    // Set explicitly rather than left to the schema default so the rule lives
    // where FR-19 is implemented, and so no client-supplied stage can reach it.
    currentStage: CandidateStage.CandidatureRecue,
    registeredBy: new Types.ObjectId(actorId),
    // registeredAt is stamped server-side by the model's pre-validate hook (D-018).
  });
};

/**
 * FR-25 — the ONLY two stages this action can move a candidate to.
 *
 * D-006 forbids a generic stage setter, and D-042 reconciles that with
 * Section 9's `PATCH /candidates/:id/stage` by making this route perform
 * exactly the one transition FR-25 describes and nothing else. Naming any
 * other stage here — even a real pipeline stage like « Accepté » — is refused,
 * so the pipeline cannot be skipped through this endpoint.
 */
export const CV_REVIEW_TARGET_STAGES = [
  CandidateStage.PreselectionCvValidee,
  CandidateStage.RejeteCv,
] as const;
export type CvReviewTargetStage = (typeof CV_REVIEW_TARGET_STAGES)[number];

export interface ReviewCvInput {
  targetStage: CvReviewTargetStage;
  /** FR-26: mandatory when — and only when — rejecting. */
  rejectionReason?: string;
}

/**
 * FR-25 / FR-26 — the CV review decision.
 *
 * Stage-gated and one-way: the candidate must currently be at
 * « Candidature reçue ». A candidate already reviewed, already rejected, or
 * further down the pipeline is refused rather than re-transitioned, so
 * "one-way" is a property the server guarantees instead of one the client is
 * trusted to respect (ARCHITECTURE.md Section 8, D-006).
 */
export const reviewCandidateCv = async (
  candidateId: string,
  input: ReviewCvInput,
  actorId: string,
): Promise<ICandidate> => {
  if (!Types.ObjectId.isValid(candidateId)) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }

  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }

  if (candidate.currentStage !== CandidateStage.CandidatureRecue) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `La présélection CV ne s'applique qu'à un candidat à l'étape ` +
        `« ${CandidateStage.CandidatureRecue} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} » : cette décision a déjà été prise.`,
    );
  }

  const isRejection = input.targetStage === CandidateStage.RejeteCv;
  const reason = input.rejectionReason?.trim();

  // FR-26: the motive is mandatory on rejection.
  if (isRejection && !reason) {
    throw new AppError(
      400,
      'REJECTION_REASON_REQUIRED',
      'Un motif de rejet est obligatoire pour rejeter un candidat à la présélection CV. Saisissez-le et renvoyez la demande.',
    );
  }

  // Storing a rejection motive against a candidate who was NOT rejected would
  // put a false statement in the record, so this is refused rather than dropped.
  if (!isRejection && reason) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      "Un motif de rejet ne peut pas accompagner une présélection validée. Retirez « rejectionReason ».",
    );
  }

  candidate.currentStage = input.targetStage;
  if (isRejection) {
    candidate.rejectionReason = reason;
  }
  await candidate.save();

  // FR-11 / rule 4 — "candidate stage change" is named explicitly in rule 4.
  // D-033: the entry records THAT the stage changed, never the motive.
  await recordAudit({
    userId: actorId,
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: candidate._id as Types.ObjectId,
  });

  // TODO(FR-40): emit a stage-change notification. The Notifications module
  // (FR-40 to FR-44) is not built yet, so none is emitted here. Grep for
  // TODO(FR-40) to find every stage-change site in one sweep — see D-042.

  return candidate;
};

/**
 * FR-27 — a successful interview scheduling moves the candidate to
 * « Entretien planifié ».
 *
 * D-006 / D-043: this is a SIDE EFFECT of FR-30, never an action a client can
 * invoke. It is exported for `interview.service.ts` alone and is deliberately
 * not wired to any route.
 *
 * The stage gate is re-checked here rather than trusted to the caller, so the
 * transition protects itself if a second caller ever appears.
 */
export const markInterviewScheduled = async (
  candidate: ICandidate,
  actorId: string,
): Promise<ICandidate> => {
  if (candidate.currentStage !== CandidateStage.PreselectionCvValidee) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `Un entretien ne peut être planifié que pour un candidat à l'étape ` +
        `« ${CandidateStage.PreselectionCvValidee} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} ».`,
    );
  }

  candidate.currentStage = CandidateStage.EntretienPlanifie;
  await candidate.save();

  // FR-11 / rule 4 — the stage change is audited, as with FR-25.
  await recordAudit({
    userId: actorId,
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: candidate._id as Types.ObjectId,
  });

  // TODO(FR-40): emit a stage-change notification. See D-042.
  return candidate;
};

/**
 * FR-34 — cancelling an interview returns the candidate to « Présélection CV
 * validée », making them schedulable again.
 *
 * Like `markInterviewScheduled`, this is a side effect of an interview action
 * and is exposed nowhere over HTTP (D-006). It re-checks the gate itself
 * rather than trusting its caller.
 */
export const revertToPreselection = async (
  candidate: ICandidate,
  actorId: string,
): Promise<ICandidate> => {
  if (candidate.currentStage !== CandidateStage.EntretienPlanifie) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `Seul un candidat à l'étape « ${CandidateStage.EntretienPlanifie} » peut revenir ` +
        `à « ${CandidateStage.PreselectionCvValidee} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} » : annuler l'entretien ne peut plus le ramener en arrière.`,
    );
  }

  candidate.currentStage = CandidateStage.PreselectionCvValidee;
  await candidate.save();

  // FR-11 / rule 4 — "candidate stage change" is named explicitly, so this
  // entry is required in its own right, independently of the EntretienAnnule
  // entry the caller writes against the Interview (D-046).
  await recordAudit({
    userId: actorId,
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: candidate._id as Types.ObjectId,
  });

  // TODO(FR-40): emit a stage-change notification. See D-042.
  return candidate;
};

/** FR-24 — the only sortable columns. Anything else is refused, not ignored. */
export const CANDIDATE_SORT_FIELDS = ['fullName', 'currentStage', 'registeredAt'] as const;
export type CandidateSortField = (typeof CANDIDATE_SORT_FIELDS)[number];

export const DEFAULT_CANDIDATE_LIMIT = 25;
export const MAX_CANDIDATE_LIMIT = 100;

export interface ListCandidatesInput {
  jobPositionId?: string;
  currentStage?: CandidateStage;
  fromDate?: Date;
  toDate?: Date;
  limit: number;
  offset: number;
  sortBy: CandidateSortField;
  sortDir: 1 | -1;
}

export interface ListCandidatesResult {
  items: Array<{ candidate: ICandidate; hasResume: boolean }>;
  total: number;
}

/**
 * FR-24 — list candidates, filterable by poste, étape and registration date
 * range, with pagination and sorting.
 *
 * No department scoping: D-027 scopes only ResponsableHierarchique, and this
 * route is Recruteur-only, so the `scopeFilter` helper D-027 left unbuilt is
 * still not needed. It becomes necessary the first time a Responsable can
 * reach a list.
 */
export const listCandidates = async (input: ListCandidatesInput): Promise<ListCandidatesResult> => {
  const query: Record<string, unknown> = {};

  if (input.jobPositionId) {
    if (!Types.ObjectId.isValid(input.jobPositionId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Identifiant de poste invalide.');
    }
    query.jobPositionId = input.jobPositionId;
  }

  if (input.currentStage) {
    query.currentStage = input.currentStage;
  }

  if (input.fromDate || input.toDate) {
    const range: Record<string, Date> = {};
    if (input.fromDate) {
      range.$gte = input.fromDate;
    }
    if (input.toDate) {
      range.$lte = input.toDate;
    }
    query.registeredAt = range;
  }

  // Counted against the SAME filter, before pagination — the total a caller
  // needs is "how many match", not "how many are on this page".
  const total = await Candidate.countDocuments(query);

  const candidates = await Candidate.find(query)
    .populate('jobPositionId', 'title')
    .sort({ [input.sortBy]: input.sortDir })
    .skip(input.offset)
    .limit(input.limit);

  // hasResume for the whole page in ONE query rather than one per row — the
  // difference between 2 queries and 1 + N, and this is the endpoint most
  // likely to grow (see the NFR-01 note in TASKS.md).
  const withResume = await Resume.find(
    { candidateId: { $in: candidates.map((c) => c._id) }, isActive: true },
    'candidateId',
  );
  const resumeOwners = new Set(withResume.map((r) => String(r.candidateId)));

  return {
    total,
    items: candidates.map((candidate) => ({
      candidate,
      hasResume: resumeOwners.has(String(candidate._id)),
    })),
  };
};

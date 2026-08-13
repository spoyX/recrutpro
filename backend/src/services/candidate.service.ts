import { Types } from 'mongoose';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { Resume } from '../models/Resume.model';
import { Interview } from '../models/Interview.model';
import { InterviewEvaluation } from '../models/InterviewEvaluation.model';
import { IUser } from '../models/User.model';
import {
  CandidateStage,
  AuditAction,
  AuditTargetType,
  NotificationType,
} from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';
import { isDepartmentScoped } from '../middleware/rbac.middleware';
import { assertAcceptsCandidates } from './jobPosition.service';
import { notify, resolveResponsibleRecruiter } from './notification.service';
// MODULE CYCLE, deliberate and safe: interview.service imports
// `markInterviewScheduled` / `revertToPreselection` from this file, so this
// import closes a loop. It works because neither side touches the other at
// module-INITIALISATION time — every reference is inside a function body, and
// CommonJS resolves those at call time against the finished exports object.
// The alternative was a second copy of the assignment predicate, which D-047
// exists to prevent: one predicate, one set of reachable candidates. Verified
// by the live run, not assumed.
import { hasAssignedInterviewWith } from './interview.service';
import { CandidateDetailSource } from '../views/candidate.view';

/**
 * FR-40 — « À chaque changement d'étape d'un candidat (hors inscription
 * initiale), une notification in-app est générée pour le recruteur responsable
 * du poste et pour le responsable hiérarchique assigné (si un entretien est
 * concerné). »
 *
 * One helper for all five transition sites, so a transition added later gets
 * the notification by calling it rather than by remembering to reimplement it.
 *
 * `alsoNotify` carries FR-40's conditional second recipient — the assigned
 * responsable, passed only by the sites where an interview really is concerned.
 * At the two sites where the responsable IS the actor (evaluation submission,
 * final decision) they are dropped by `notify`'s actor filter rather than by a
 * special case here.
 *
 * Never throws: D-054 makes delivery best-effort, and this runs only after the
 * stage change and its rule-4 audit entry have both succeeded.
 */
const notifyStageChange = async (
  candidate: ICandidate,
  message: string,
  actorId: string,
  alsoNotify?: Types.ObjectId | string | null,
): Promise<void> => {
  const recruiter = await resolveResponsibleRecruiter(candidate).catch(() => null);
  await notify([recruiter, alsoNotify], NotificationType.ChangementEtape, message, actorId);
};

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

  // FR-40 — no interview is concerned at CV review, so the responsible
  // recruiter is the only recipient. Closes the debt D-042 recorded here.
  await notifyStageChange(
    candidate,
    `La candidature de « ${candidate.fullName} » est passée à l'étape ` +
      `« ${candidate.currentStage} ».`,
    actorId,
  );

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

  // FR-40 — the assigned responsable is NOT passed here: they receive the more
  // specific FR-42 « un entretien vous a été assigné » notification from the
  // interview service instead. Sending both would put two rows in one panel
  // for a single action.
  await notifyStageChange(
    candidate,
    `Un entretien a été planifié pour « ${candidate.fullName} » : la candidature ` +
      `passe à l'étape « ${CandidateStage.EntretienPlanifie} ».`,
    actorId,
  );

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
  /** FR-40's conditional recipient — an interview IS concerned here (D-046). */
  interviewerId?: Types.ObjectId | string | null,
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

  // FR-40 — an interview IS concerned, so the assigned responsable is told too:
  // a cancelled interview is exactly the kind of thing they must not turn up
  // for. The message names the cancellation rather than only the new stage,
  // because "revenu à Présélection CV validée" alone would not tell them that.
  await notifyStageChange(
    candidate,
    `L'entretien avec « ${candidate.fullName} » a été annulé : la candidature ` +
      `revient à l'étape « ${CandidateStage.PreselectionCvValidee} ».`,
    actorId,
    interviewerId,
  );

  return candidate;
};

/**
 * FR-29 / FR-39 — the ONLY two stages the final decision can move a candidate
 * to. Same shape as CV_REVIEW_TARGET_STAGES: naming any other stage, even a
 * real one, is refused, so this cannot become a generic setter (D-006, D-051).
 */
export const FINAL_DECISION_STAGES = [CandidateStage.Accepte, CandidateStage.Rejete] as const;
export type FinalDecisionStage = (typeof FINAL_DECISION_STAGES)[number];

/**
 * FR-29 / FR-39 — the final hire/reject decision.
 *
 * Gated on « Évaluation complétée »: FR-39's « peut **ensuite** émettre »
 * makes this sequential, so a decision can neither skip the evaluation nor be
 * re-issued once taken. The comment is mandatory for BOTH outcomes.
 */
export const decideFinalOutcome = async (
  candidate: ICandidate,
  targetStage: FinalDecisionStage,
  decisionComment: string | undefined,
  actorId: string,
): Promise<ICandidate> => {
  if (candidate.currentStage !== CandidateStage.EvaluationCompletee) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `La décision finale n'est possible qu'à partir de l'étape ` +
        `« ${CandidateStage.EvaluationCompletee} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} ».`,
    );
  }

  const comment = decisionComment?.trim();
  if (!comment) {
    throw new AppError(
      400,
      'DECISION_COMMENT_REQUIRED',
      'Un commentaire est obligatoire pour la décision finale, qu\'elle soit favorable ou non. Saisissez-le et renvoyez la demande.',
    );
  }

  candidate.currentStage = targetStage;
  candidate.decisionComment = comment;
  // D-058: stamped on BOTH terminal outcomes, not only « Accepté ». The field
  // records WHEN the decision was taken, so a null value must mean exactly one
  // thing — "not yet decided". Stamping only acceptances would make null
  // ambiguous between that and "decided negatively", which is how a metric
  // quietly goes wrong. The time-to-hire report filters to « Accepté » itself.
  // Server-stamped here, never from the request (the same rule as D-018).
  candidate.decidedAt = new Date();
  await candidate.save();

  // FR-11 / rule 4 — consistent with every other transition.
  await recordAudit({
    userId: actorId,
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: candidate._id as Types.ObjectId,
  });

  // FR-40 — the decision is the assigned responsable's own action, so they are
  // dropped by the actor filter and the responsible recruiter is informed of
  // the outcome they did not take.
  await notifyStageChange(
    candidate,
    `Décision finale pour « ${candidate.fullName} » : la candidature passe à ` +
      `l'étape « ${candidate.currentStage} ».`,
    actorId,
  );

  return candidate;
};

/**
 * FR-28 / FR-38 — submitting an evaluation moves the candidate to
 * « Évaluation complétée ».
 *
 * The third of the pipeline side effects, and shaped exactly like
 * `markInterviewScheduled` and `revertToPreselection`: gated on the stage it
 * comes from, audited, and exposed nowhere over HTTP (D-006).
 */
export const markEvaluationCompleted = async (
  candidate: ICandidate,
  actorId: string,
): Promise<ICandidate> => {
  if (candidate.currentStage !== CandidateStage.EntretienPlanifie) {
    throw new AppError(
      409,
      'INVALID_STAGE_TRANSITION',
      `Une évaluation ne peut être enregistrée que pour un candidat à l'étape ` +
        `« ${CandidateStage.EntretienPlanifie} ». Ce candidat est à l'étape ` +
        `« ${candidate.currentStage} ».`,
    );
  }

  candidate.currentStage = CandidateStage.EvaluationCompletee;
  await candidate.save();

  // FR-11 / rule 4 — "candidate stage change" is named explicitly, exactly as
  // for every other transition (FR-25, FR-27, FR-34).
  await recordAudit({
    userId: actorId,
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: candidate._id as Types.ObjectId,
  });

  // FR-40 AND FR-41 are ONE notification here, not two.
  //
  // Both name the same recipient (the responsible recruiter) for the same
  // event, so two rows would say the same thing twice in one panel. The type
  // is the MORE SPECIFIC of the two — `EvaluationSoumise` rather than
  // `ChangementEtape` — and the message carries both facts, so FR-40's "a
  // notification is generated for the recruiter on a stage change" and FR-41's
  // "a notification is sent to the recruiter when an evaluation is submitted"
  // are each satisfied by it. The submitting responsable is the actor and is
  // filtered out. Closes the debt D-050 recorded here.
  const recruiter = await resolveResponsibleRecruiter(candidate).catch(() => null);
  await notify(
    [recruiter],
    NotificationType.EvaluationSoumise,
    `Une évaluation a été soumise pour « ${candidate.fullName} » : la candidature ` +
      `passe à l'étape « ${CandidateStage.EvaluationCompletee} ».`,
    actorId,
  );

  return candidate;
};

/**
 * `GET /candidates/:id` — the Candidate Details page's whole payload (D-067).
 *
 * WHY THIS IS COMPOSED SERVER-SIDE: the page shows the CV, the interview
 * history and each interview's evaluation, and NONE of the three is reachable
 * from an existing endpoint. There is no resume-metadata route (only the FR-23
 * download proxy), `GET /interviews` has no candidate filter, and no route
 * returns an evaluation at all. Composing client-side would therefore mean
 * inventing three MORE routes outside the Section 9 contract instead of
 * building the one it already lists — and it would cost a round trip per
 * interview against NFR-01. Same reasoning D-057 applied to the dashboard.
 *
 * WHO: Recruteur unrestricted (the module is theirs). A Responsable
 * hiérarchique only for a candidate they actually interview, in their own
 * department — `hasAssignedInterviewWith`, the SAME predicate as the FR-35
 * list, the FR-23 CV download, the FR-36 evaluation and the FR-29 decision.
 * Its fifth use, so the set of candidates that role can see, read, evaluate
 * and decide on stays one set by construction (D-047, D-048, D-051).
 * Administrateur is refused by the router: no FR grants it a candidate's file.
 */
export const getCandidateDetail = async (
  candidateId: string,
  viewer: IUser,
): Promise<CandidateDetailSource> => {
  // A malformed id is "no such candidate", not a cast error (D-055's rule).
  if (!Types.ObjectId.isValid(candidateId)) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }

  // Loaded UNPOPULATED on purpose. `hasAssignedInterviewWith` reads
  // `candidate.jobPositionId` as an id; handing it a populated `{_id, title}`
  // object would make the authorisation check depend on Mongoose's casting of
  // a sub-document, which is not a thing a security gate should rest on. The
  // refs are populated below, AFTER the decision to allow has been made.
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }

  // Checked against the LOADED candidate, never a client-supplied value
  // (rule 2, NFR-04). 403 rather than 404 follows D-027's resolved rule: every
  // caller here is an authenticated employee, so a clear refusal beats a
  // misleading "not found".
  if (isDepartmentScoped(viewer) && !(await hasAssignedInterviewWith(viewer, candidate))) {
    throw new AppError(
      403,
      'FORBIDDEN',
      "Vous ne pouvez consulter que les candidats dont vous menez l'entretien.",
    );
  }

  await candidate.populate([
    { path: 'jobPositionId', select: 'title' },
    { path: 'registeredBy', select: 'name' },
  ]);

  const interviews = await Interview.find({ candidateId: candidate._id })
    .populate('interviewerId', 'name')
    // Newest first. FR-33's schedule sorts FORWARD because it is a queue of
    // work still to come; this is a HISTORY, where the most recent event is
    // the one being read — the same newest-first rule as D-041 and D-060.
    .sort({ scheduledAt: -1 });

  // Both remaining reads are ONE query for the whole page, not one per
  // interview — the D-041 rule about `hasResume`, applied again.
  const evaluations = await InterviewEvaluation.find({
    interviewId: { $in: interviews.map((i) => i._id) },
  }).populate('submittedBy', 'name');
  const byInterview = new Map(evaluations.map((e) => [String(e.interviewId), e]));

  // Only an ACTIVE resume counts, so an FR-22 replacement's superseded row does
  // not read as a downloadable CV.
  const hasResume = Boolean(
    await Resume.exists({ candidateId: candidate._id, isActive: true }),
  );

  return {
    candidate: candidate as never,
    hasResume,
    interviews: interviews.map((interview) => ({
      interview: interview as never,
      evaluation: (byInterview.get(String(interview._id)) ?? null) as never,
    })),
    // FR-35 enumerates what this role gets, and contact details are not in it.
    redactContactDetails: isDepartmentScoped(viewer),
  };
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
    // `_id` is a TIEBREAKER, not a second sort the caller asked for (D-069).
    // MongoDB's sort is not stable, so rows tied on the sort key may come back
    // in a different relative order for each query. With skip/limit that means
    // a row can appear on page 1 AND page 2 while another is never returned at
    // all — silently, with a correct-looking total. `currentStage` has only
    // seven distinct values, so ties there are the normal case, not an edge
    // one. Appending the unique `_id` makes the ordering total and therefore
    // pagination stable. Found in live verification, not by the unit tests.
    .sort({ [input.sortBy]: input.sortDir, _id: 1 })
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

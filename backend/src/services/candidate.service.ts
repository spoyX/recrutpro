import { Types } from 'mongoose';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { Resume } from '../models/Resume.model';
import { CandidateStage } from '../common/constants';
import { AppError } from '../common/errors';
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

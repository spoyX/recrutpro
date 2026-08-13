import { ICandidate } from '../models/Candidate.model';
import { IInterview } from '../models/Interview.model';
import { IInterviewEvaluation } from '../models/InterviewEvaluation.model';
import { CandidateStage, InterviewStatus } from '../common/constants';

/** The "V" of MVC (D-003): the JSON shape a Candidate takes on the way out. */
export interface PublicCandidate {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: string;
  currentStage: CandidateStage;
  registeredBy: string;
  registeredAt: string;
  /** FR-26 / D-042: present only once rejected at the CV stage. */
  rejectionReason: string | null;
  /** D-058: when the FR-29 final decision was taken. Null until then. */
  decidedAt: string | null;
}

/**
 * FR-24 — the list row. Deliberately NOT the same shape as PublicCandidate:
 * the list carries the job position's TITLE (populated, so the caller does not
 * have to resolve every id itself) and `hasResume`, and drops `registeredBy`,
 * which no list column shows.
 */
export interface CandidateListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  jobPosition: { id: string; title: string } | null;
  currentStage: CandidateStage;
  registeredAt: string;
  hasResume: boolean;
}

/** A candidate whose `jobPositionId` has been populated with the title. */
type PopulatedCandidate = Omit<ICandidate, 'jobPositionId'> & {
  jobPositionId: { _id: unknown; title: string } | null;
};

export const toCandidateListItem = (
  candidate: PopulatedCandidate,
  hasResume: boolean,
): CandidateListItem => ({
  id: String(candidate._id),
  fullName: candidate.fullName,
  email: candidate.email,
  phone: candidate.phone,
  // Null only if the referenced position was somehow removed. FR-18 makes that
  // unreachable today, but a list must not throw because one row is odd.
  jobPosition: candidate.jobPositionId
    ? { id: String(candidate.jobPositionId._id), title: candidate.jobPositionId.title }
    : null,
  currentStage: candidate.currentStage,
  registeredAt: candidate.registeredAt.toISOString(),
  hasResume,
});

/**
 * The Candidate Details page's payload (D-067).
 *
 * Deliberately a THIRD shape, not a widened `PublicCandidate`: a details page
 * shows a candidate's whole file — the position, who registered them, the CV,
 * every interview and each interview's evaluation — which no other caller of
 * `toPublicCandidate` wants, and several of those facts live in other
 * collections entirely.
 *
 * The evaluation hangs off ITS interview rather than sitting at the top level.
 * A candidate can have more than one interview (cancel then reschedule, FR-34),
 * and one evaluation exists per interview (D-016's unique index) — so a single
 * top-level `evaluation` would have to pick one and would silently misattribute
 * it the moment there are two.
 */
export interface CandidateDetail {
  id: string;
  fullName: string;
  /**
   * FR-35 grants a Responsable hiérarchique « le nom du candidat, le poste et
   * un accès au CV » — not contact details. Both are NULL for that role rather
   * than absent, so the client renders one shape and the omission is a visible,
   * deliberate fact instead of a missing key it might treat as a bug.
   */
  email: string | null;
  phone: string | null;
  jobPosition: { id: string; title: string } | null;
  currentStage: CandidateStage;
  registeredBy: { id: string; name: string } | null;
  registeredAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  decisionComment: string | null;
  /** D-040: `url` is this API's own proxy route, never a storage URL. */
  resume: { hasResume: boolean; url: string | null };
  interviews: CandidateDetailInterview[];
}

export interface CandidateDetailInterview {
  id: string;
  scheduledAt: string;
  status: InterviewStatus;
  interviewer: { id: string; name: string } | null;
  cancellationReason: string | null;
  evaluation: CandidateDetailEvaluation | null;
}

export interface CandidateDetailEvaluation {
  id: string;
  scores: { technicalSkills: number; communication: number; overallFit: number };
  comments: string | null;
  submittedBy: { id: string; name: string } | null;
}

/** A ref that may or may not have been populated into a `{_id, name}` object. */
type MaybePopulatedUser = { _id: unknown; name: string } | null | undefined;

const toNamedRef = (ref: MaybePopulatedUser): { id: string; name: string } | null =>
  // A ref that was never populated arrives as a bare ObjectId with no `name`.
  // Returning null beats emitting `{id, name: undefined}`, which would render
  // as an empty label the reader cannot distinguish from a person with no name.
  ref && typeof ref === 'object' && 'name' in ref && typeof ref.name === 'string'
    ? { id: String(ref._id), name: ref.name }
    : null;

export interface CandidateDetailSource {
  candidate: PopulatedCandidate & { registeredBy?: unknown };
  hasResume: boolean;
  interviews: Array<{
    interview: Omit<IInterview, 'interviewerId'> & { interviewerId: MaybePopulatedUser };
    evaluation:
      | (Omit<IInterviewEvaluation, 'submittedBy'> & { submittedBy: MaybePopulatedUser })
      | null;
  }>;
  /** True when the viewer is a Responsable hiérarchique — see `email` above. */
  redactContactDetails: boolean;
}

export const toCandidateDetail = (source: CandidateDetailSource): CandidateDetail => {
  const { candidate } = source;

  return {
    id: String(candidate._id),
    fullName: candidate.fullName,
    email: source.redactContactDetails ? null : candidate.email,
    phone: source.redactContactDetails ? null : candidate.phone,
    jobPosition: candidate.jobPositionId
      ? { id: String(candidate.jobPositionId._id), title: candidate.jobPositionId.title }
      : null,
    currentStage: candidate.currentStage,
    // `unknown` first: unpopulated it is a bare ObjectId, populated it is
    // `{_id, name}`. `toNamedRef` is what tells the two apart at runtime.
    registeredBy: toNamedRef(candidate.registeredBy as unknown as MaybePopulatedUser),
    registeredAt: candidate.registeredAt.toISOString(),
    decidedAt: candidate.decidedAt ? candidate.decidedAt.toISOString() : null,
    rejectionReason: candidate.rejectionReason ?? null,
    decisionComment: candidate.decisionComment ?? null,
    resume: {
      hasResume: source.hasResume,
      // Only offered when there is something behind it, so the client never
      // renders a download link that 404s (NFR-09).
      url: source.hasResume ? `/api/v1/candidates/${String(candidate._id)}/resume` : null,
    },
    interviews: source.interviews.map(({ interview, evaluation }) => ({
      id: String(interview._id),
      scheduledAt: interview.scheduledAt.toISOString(),
      status: interview.status,
      interviewer: toNamedRef(interview.interviewerId),
      cancellationReason: interview.cancellationReason ?? null,
      evaluation: evaluation
        ? {
            id: String(evaluation._id),
            scores: {
              technicalSkills: evaluation.scores.technicalSkills,
              communication: evaluation.scores.communication,
              overallFit: evaluation.scores.overallFit,
            },
            comments: evaluation.comments ?? null,
            submittedBy: toNamedRef(evaluation.submittedBy),
          }
        : null,
    })),
  };
};

export const toPublicCandidate = (candidate: ICandidate): PublicCandidate => ({
  id: String(candidate._id),
  fullName: candidate.fullName,
  email: candidate.email,
  phone: candidate.phone,
  jobPositionId: String(candidate.jobPositionId),
  currentStage: candidate.currentStage,
  registeredBy: String(candidate.registeredBy),
  registeredAt: candidate.registeredAt.toISOString(),
  rejectionReason: candidate.rejectionReason ?? null,
  decidedAt: candidate.decidedAt ? candidate.decidedAt.toISOString() : null,
});

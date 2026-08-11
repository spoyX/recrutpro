import { ICandidate } from '../models/Candidate.model';
import { CandidateStage } from '../common/constants';

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

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
}

export const toPublicCandidate = (candidate: ICandidate): PublicCandidate => ({
  id: String(candidate._id),
  fullName: candidate.fullName,
  email: candidate.email,
  phone: candidate.phone,
  jobPositionId: String(candidate.jobPositionId),
  currentStage: candidate.currentStage,
  registeredBy: String(candidate.registeredBy),
  registeredAt: candidate.registeredAt.toISOString(),
});

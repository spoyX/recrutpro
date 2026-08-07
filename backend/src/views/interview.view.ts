import { IInterview } from '../models/Interview.model';
import { InterviewStatus } from '../common/constants';

/** The "V" of MVC (D-003): the JSON shape an Interview takes on the way out. */
export interface PublicInterview {
  id: string;
  candidateId: string;
  interviewerId: string;
  scheduledAt: string;
  status: InterviewStatus;
  cancellationReason: string | null;
}

export const toPublicInterview = (interview: IInterview): PublicInterview => ({
  id: String(interview._id),
  candidateId: String(interview.candidateId),
  interviewerId: String(interview.interviewerId),
  scheduledAt: interview.scheduledAt.toISOString(),
  status: interview.status,
  cancellationReason: interview.cancellationReason ?? null,
});

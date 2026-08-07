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

/**
 * FR-33 — the list row. Carries the names a schedule has to show, so the
 * caller does not resolve three ids per row itself.
 */
export interface InterviewListItem {
  id: string;
  scheduledAt: string;
  status: InterviewStatus;
  candidate: { id: string; fullName: string } | null;
  jobPosition: { id: string; title: string } | null;
  interviewer: { id: string; name: string } | null;
  cancellationReason: string | null;
}

/** An Interview with candidate (and its position) and interviewer populated. */
type PopulatedInterview = Omit<IInterview, 'candidateId' | 'interviewerId'> & {
  candidateId:
    | { _id: unknown; fullName: string; jobPositionId?: { _id: unknown; title: string } | null }
    | null;
  interviewerId: { _id: unknown; name: string } | null;
};

export const toInterviewListItem = (interview: PopulatedInterview): InterviewListItem => {
  const candidate = interview.candidateId;
  const position = candidate?.jobPositionId ?? null;

  return {
    id: String(interview._id),
    scheduledAt: interview.scheduledAt.toISOString(),
    status: interview.status,
    // Null-tolerant throughout: one odd row must not break the whole list.
    candidate: candidate ? { id: String(candidate._id), fullName: candidate.fullName } : null,
    jobPosition: position ? { id: String(position._id), title: position.title } : null,
    interviewer: interview.interviewerId
      ? { id: String(interview.interviewerId._id), name: interview.interviewerId.name }
      : null,
    cancellationReason: interview.cancellationReason ?? null,
  };
};

export const toPublicInterview = (interview: IInterview): PublicInterview => ({
  id: String(interview._id),
  candidateId: String(interview.candidateId),
  interviewerId: String(interview.interviewerId),
  scheduledAt: interview.scheduledAt.toISOString(),
  status: interview.status,
  cancellationReason: interview.cancellationReason ?? null,
});

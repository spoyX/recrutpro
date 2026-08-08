import { IInterviewEvaluation } from '../models/InterviewEvaluation.model';

/** The "V" of MVC (D-003): the JSON shape an evaluation takes on the way out. */
export interface PublicEvaluation {
  id: string;
  interviewId: string;
  scores: {
    technicalSkills: number;
    communication: number;
    overallFit: number;
  };
  comments: string | null;
  submittedBy: string;
}

export const toPublicEvaluation = (evaluation: IInterviewEvaluation): PublicEvaluation => ({
  id: String(evaluation._id),
  interviewId: String(evaluation.interviewId),
  scores: {
    technicalSkills: evaluation.scores.technicalSkills,
    communication: evaluation.scores.communication,
    overallFit: evaluation.scores.overallFit,
  },
  comments: evaluation.comments ?? null,
  submittedBy: String(evaluation.submittedBy),
});

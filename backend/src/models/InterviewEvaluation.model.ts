import { Schema, model, Document, Types } from 'mongoose';

export interface IEvaluationScores {
  technicalSkills: number;
  communication: number;
  overallFit: number;
}

export interface IInterviewEvaluation extends Document {
  interviewId: Types.ObjectId;
  scores: IEvaluationScores;
  comments?: string;
  submittedBy: Types.ObjectId;
}

// FR-36: notes de 1 à 5 pour au moins trois critères. The three criteria are
// the ones SRS.md FR-36 names (compétences techniques, communication,
// adéquation globale). Every one is required, which is what enforces FR-37 —
// submission is blocked when a mandatory score is missing.
const scoreField = { type: Number, required: true, min: 1, max: 5 };

const interviewEvaluationSchema = new Schema<IInterviewEvaluation>({
  interviewId: { type: Schema.Types.ObjectId, ref: 'Interview', required: true },

  scores: {
    type: {
      technicalSkills: scoreField,
      communication: scoreField,
      overallFit: scoreField,
    },
    required: true,
    _id: false,
  },

  // FR-36 provides a comments field, but FR-37 makes only the scores
  // mandatory, so this stays optional.
  comments: { type: String, trim: true },

  submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});

// FR-28/FR-38: submitting an evaluation drives a one-way stage transition,
// so an interview carries at most one evaluation.
interviewEvaluationSchema.index({ interviewId: 1 }, { unique: true });

export const InterviewEvaluation = model<IInterviewEvaluation>(
  'InterviewEvaluation',
  interviewEvaluationSchema,
);

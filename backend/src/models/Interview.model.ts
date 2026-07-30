import { Schema, model, Document, Types } from 'mongoose';
import { InterviewStatus } from '../common/constants';

export interface IInterview extends Document {
  candidateId: Types.ObjectId;
  interviewerId: Types.ObjectId;
  scheduledAt: Date;
  status: InterviewStatus;
  cancellationReason?: string;
}

const interviewSchema = new Schema<IInterview>({
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },

  // FR-30: must be a Responsable hiérarchique belonging to the job's
  // department. That cross-entity rule is enforced in interview.service.ts —
  // a schema cannot see the job position's department.
  interviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  scheduledAt: { type: Date, required: true },

  status: {
    type: String,
    required: true,
    enum: Object.values(InterviewStatus),
    default: InterviewStatus.Planifie,
  },

  // FR-34: cancelling records a reason, so it is mandatory once, and only
  // once, the interview is cancelled.
  cancellationReason: {
    type: String,
    trim: true,
    required: function (this: IInterview): boolean {
      return this.status === InterviewStatus.Annule;
    },
  },
});

// FR-31: conflict detection scans one interviewer's slots inside a
// 30-minute window (D-005), so it always queries on this pair.
interviewSchema.index({ interviewerId: 1, scheduledAt: 1 });

export const Interview = model<IInterview>('Interview', interviewSchema);

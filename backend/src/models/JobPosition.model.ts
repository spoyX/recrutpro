import { Schema, model, Document, Types } from 'mongoose';
import { JobPositionStatus } from '../common/constants';

export interface IJobPosition extends Document {
  title: string;
  department: Types.ObjectId;
  description: string;
  requirements?: string;
  status: JobPositionStatus;
  createdAt: Date;
}

const jobPositionSchema = new Schema<IJobPosition>({
  // FR-14: intitulé, département, description, exigences, statut
  title: { type: String, required: true, trim: true },

  department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },

  description: { type: String, required: true, trim: true },

  requirements: { type: String, trim: true },

  status: {
    type: String,
    required: true,
    enum: Object.values(JobPositionStatus),
    default: JobPositionStatus.Brouillon,
  },

  // FR-14: recorded automatically. FR-15: every field of an open position is
  // editable EXCEPT this one, so it is immutable at the schema level.
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
});

export const JobPosition = model<IJobPosition>('JobPosition', jobPositionSchema);

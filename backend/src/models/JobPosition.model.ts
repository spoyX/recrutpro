import { Schema, model, Document, Types } from 'mongoose';
import { JobPositionStatus } from '../common/constants';

export interface IJobPosition extends Document {
  title: string;
  department: Types.ObjectId;
  description: string;
  requirements?: string;
  status: JobPositionStatus;
  createdAt: Date;
  createdBy?: Types.ObjectId;
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

  // D-052: the recruiter who created the position — FR-40/FR-41's « le
  // recruteur responsable du poste ». FOR NOTIFICATION ROUTING ONLY. It is
  // NOT an access-control field: D-037 stands, and any Recruteur may still
  // create, read, edit and close any position regardless of what this says.
  // No route consults it for authorisation, and none may start to.
  //
  // NOT required: positions created before this field existed have none, and
  // making it required would fail the next `save()` on every one of them —
  // i.e. break FR-15 edits on legacy rows. D-052's fallback to
  // `Candidate.registeredBy` covers those at notification time (Step 2).
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
});

export const JobPosition = model<IJobPosition>('JobPosition', jobPositionSchema);

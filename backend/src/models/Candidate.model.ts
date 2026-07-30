import { Schema, model, Document, Types } from 'mongoose';
import { CandidateStage, EMAIL_PATTERN } from '../common/constants';

export interface ICandidate extends Document {
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: Types.ObjectId;
  currentStage: CandidateStage;
  registeredBy: Types.ObjectId;
}

const candidateSchema = new Schema<ICandidate>({
  // FR-19: nom complet, email, téléphone, poste lié
  fullName: { type: String, required: true, trim: true },

  // NOT unique — globally or otherwise. FR-20 / D-004: duplicate detection is
  // a scoped (email + jobPositionId) LOOKUP performed by the service, and the
  // recruiter may deliberately confirm the duplicate. A unique index would
  // make that confirmation impossible.
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [EMAIL_PATTERN, 'Adresse email invalide'],
  },

  phone: { type: String, required: true, trim: true },

  jobPositionId: { type: Schema.Types.ObjectId, ref: 'JobPosition', required: true },

  // ARCHITECTURE.md Section 8 / D-006: never assigned directly by a
  // controller. FR-19 fixes the initial value.
  currentStage: {
    type: String,
    required: true,
    enum: Object.values(CandidateStage),
    default: CandidateStage.CandidatureRecue,
  },

  registeredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
});

// FR-20: supports the scoped duplicate lookup. Deliberately NOT unique.
candidateSchema.index({ email: 1, jobPositionId: 1 });

export const Candidate = model<ICandidate>('Candidate', candidateSchema);

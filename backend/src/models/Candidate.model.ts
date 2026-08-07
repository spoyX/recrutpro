import { Schema, model, Document, Types } from 'mongoose';
import { CandidateStage, EMAIL_PATTERN } from '../common/constants';

export interface ICandidate extends Document {
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: Types.ObjectId;
  currentStage: CandidateStage;
  registeredBy: Types.ObjectId;
  registeredAt: Date;
  rejectionReason?: string;
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

  // FR-24 / D-018: the registration date the candidate list filters on.
  // Server-assigned, never client-supplied — see the pre-validate hook below.
  // Immutable so it cannot drift after creation and skew time-to-hire.
  registeredAt: { type: Date, required: true, default: Date.now, immutable: true },

  // FR-26 / D-042: the mandatory motive for a rejection at the CV stage.
  // Added beyond ARCHITECTURE.md Section 7's field list because FR-26 requires
  // the motive to be entered, which is meaningless unless it is stored — and
  // AuditLog cannot hold it, since D-033 fixes audit entries to who/what/when
  // with no payload. Optional at the schema level because it applies only to
  // the "Rejeté (CV)" transition; the service is what makes it mandatory there.
  rejectionReason: { type: String, trim: true },
});

// D-018: stamp registeredAt on the server for every new candidate, overwriting
// anything that arrived in the request body. `default` alone would not do this —
// a client-supplied value satisfies the default and would be persisted as-is.
candidateSchema.pre('validate', function () {
  if (this.isNew) {
    this.set('registeredAt', new Date());
  }
});

// FR-20: supports the scoped duplicate lookup. Deliberately NOT unique.
candidateSchema.index({ email: 1, jobPositionId: 1 });

export const Candidate = model<ICandidate>('Candidate', candidateSchema);

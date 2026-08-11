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
  decisionComment?: string;
  decidedAt?: Date;
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

  // FR-29 / FR-39 / D-051: the mandatory comment on the FINAL decision.
  // Distinct from rejectionReason, which is the CV-stage motive: FR-29
  // requires a comment for « Accepté » too, and a comment on an acceptance is
  // not a rejection reason. Optional at the schema level because it applies
  // only to the terminal transition; the service makes it mandatory there.
  decisionComment: { type: String, trim: true },

  // D-058: WHEN the FR-29/FR-39 final decision was taken. The end date of the
  // time-to-hire report, whose start date is `registeredAt` (D-018, added for
  // exactly this purpose). Server-stamped by `decideFinalOutcome` and never
  // accepted from a request — the controller destructures named fields, so
  // there is no path by which a client value reaches here.
  //
  // NOT derived from AuditLog: D-052 established that the audit trail must not
  // become load-bearing for business logic, and there is no index on
  // (action, targetId) to derive it efficiently anyway.
  //
  // `immutable` is a FUNCTION, not `true`. Mongoose's `immutable: true` only
  // permits a value at CREATION — it silently ignores a set on an already-saved
  // document, which is precisely when this field is written, so `true` would
  // make the field permanently null. As a function it is mutable while unset
  // and immutable once written: set-once semantics, which is what "immutable"
  // means for a field stamped mid-life. (`registeredAt` can use `true` because
  // it is stamped at creation.)
  decidedAt: { type: Date, immutable: (doc: ICandidate) => doc.decidedAt != null },
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

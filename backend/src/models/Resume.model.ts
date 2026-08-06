import { Schema, model, Document, Types } from 'mongoose';

export interface IResume extends Document {
  candidateId: Types.ObjectId;
  fileUrl: string;
  publicId: string;
  uploadedAt: Date;
  isActive: boolean;
}

const resumeSchema = new Schema<IResume>({
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },

  // FR-21: path to the stored file. ARCHITECTURE.md rule 5 requires the file
  // itself to live outside the web root; MIME + signature + 5MB checks are
  // upload-middleware concerns (D-007), not schema concerns.
  fileUrl: { type: String, required: true, trim: true },

  // D-040: the Cloudinary public_id. Added beyond Section 7's field list
  // because deleting the previous asset (FR-22) and signing a delivery URL
  // (FR-23) are both impossible from the URL alone. Never exposed to clients.
  publicId: { type: String, required: true, trim: true },

  uploadedAt: { type: Date, required: true, default: Date.now, immutable: true },

  // FR-22: replacing a CV flips the previous row to inactive rather than
  // deleting it, so the old file stops being reachable but history survives.
  isActive: { type: Boolean, required: true, default: true },
});

// FR-23: fetching a candidate's current CV is the common read.
resumeSchema.index({ candidateId: 1, isActive: 1 });

export const Resume = model<IResume>('Resume', resumeSchema);

import { Schema, model, Document, Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../common/constants';

export interface IAuditLog extends Document {
  userId: Types.ObjectId;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: Types.ObjectId;
  timestamp: Date;
}

// FR-11 / ARCHITECTURE.md rule 4. Every field is immutable: an audit trail
// that can be edited after the fact is not an audit trail.
const auditLogSchema = new Schema<IAuditLog>({
  // The actor who performed the action, not the target
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },

  action: {
    type: String,
    required: true,
    enum: Object.values(AuditAction),
    immutable: true,
  },

  targetType: {
    type: String,
    required: true,
    enum: Object.values(AuditTargetType),
    immutable: true,
  },

  targetId: { type: Schema.Types.ObjectId, required: true, immutable: true },

  timestamp: { type: Date, required: true, default: Date.now, immutable: true },
});

// FR-47 / UC-04: the admin dashboard reads the most recent entries, and the
// audit view filters by actor.
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);

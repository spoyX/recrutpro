import { Types } from 'mongoose';
import { AuditLog } from '../models/AuditLog.model';
import { AuditAction, AuditTargetType } from './constants';

export interface AuditEntry {
  /** The user who PERFORMED the action (FR-11: "l'identifiant de l'administrateur"). */
  userId: Types.ObjectId | string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: Types.ObjectId | string;
}

/**
 * FR-11 / ARCHITECTURE.md rule 4 — record a sensitive action.
 *
 * Deliberately NOT swallowing errors: if the audit write fails the request
 * fails too. An action that silently escapes the trail is exactly what rule 4
 * exists to prevent, and a loud failure is easier to notice than a quiet gap.
 *
 * ponytail: the domain write and this write are not atomic — a crash between
 * them loses the entry. MongoDB transactions need a replica set, and the
 * compose deployment (D-015) runs a standalone mongod. Revisit if the
 * deployment ever gains a replica set.
 */
export const recordAudit = async (entry: AuditEntry): Promise<void> => {
  await AuditLog.create({
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
  });
};

import { IAuditLog } from '../models/AuditLog.model';
import { AuditAction, AuditTargetType } from '../common/constants';

/**
 * The "V" of MVC (D-003): the JSON shape an AuditLog entry takes on the way
 * out. Shared by `GET /audit-logs` (UC-04) and the FR-47 admin dashboard, so
 * the two can never drift into showing the same entry differently.
 */
export interface PublicAuditLog {
  id: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  timestamp: string;
  /**
   * The ACTOR — populated to a name because a bare ObjectId is unreadable in
   * an audit view (NFR-09), and « qui a fait quoi » is the whole point.
   * Null-tolerant: one entry whose user was somehow removed must not break the
   * whole page.
   */
  user: { id: string; name: string } | null;
}

/** A populated actor ref, or a bare ObjectId when the populate found nothing. */
type ActorRef = { _id?: unknown; name?: string } | null | undefined;

export const toPublicAuditLog = (entry: IAuditLog): PublicAuditLog => {
  const actor = entry.userId as ActorRef;

  return {
    id: String(entry._id),
    action: entry.action,
    targetType: entry.targetType,
    targetId: String(entry.targetId),
    timestamp: entry.timestamp.toISOString(),
    // D-033 holds: who / what / when only. An audit entry carries NO payload,
    // so there is nothing else here to expose.
    user:
      actor && typeof actor === 'object' && 'name' in actor
        ? { id: String(actor._id), name: String(actor.name) }
        : null,
  };
};

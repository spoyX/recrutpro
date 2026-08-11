import { AuditLog, IAuditLog } from '../models/AuditLog.model';
import { AuditAction, AuditTargetType } from '../common/constants';

/**
 * UC-04 — « Consulter le journal d'audit : visualiser et filtrer l'historique
 * des actions utilisateur ». Administrateur only, per ARCHITECTURE.md
 * Section 9, which has listed `GET /audit-logs` since the beginning.
 *
 * Read-only by construction: the model marks every field `immutable` (D-016),
 * and nothing here writes. Reads are not audited, consistent with FR-12,
 * FR-24, FR-33, FR-35 and FR-43 — rule 4 covers state changes.
 */

/** Fixed page size. UC-04 is a "recent history" view, not an export. */
export const AUDIT_LOG_LIMIT = 50;

export interface ListAuditLogsInput {
  action?: AuditAction;
  targetType?: AuditTargetType;
}

export interface ListAuditLogsResult {
  items: IAuditLog[];
  /** Total matching the filter, before the 50-row cap. */
  total: number;
}

export const listAuditLogs = async (
  input: ListAuditLogsInput,
): Promise<ListAuditLogsResult> => {
  const query: Record<string, unknown> = {};

  if (input.action) {
    query.action = input.action;
  }
  if (input.targetType) {
    query.targetType = input.targetType;
  }

  const [items, total] = await Promise.all([
    AuditLog.find(query)
      .populate('userId', 'name')
      // Served by the model's existing { timestamp: -1 } index.
      .sort({ timestamp: -1 })
      .limit(AUDIT_LOG_LIMIT),
    AuditLog.countDocuments(query),
  ]);

  return { items, total };
};

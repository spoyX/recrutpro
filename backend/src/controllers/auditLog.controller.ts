import { RequestHandler } from 'express';
import { listAuditLogs, AUDIT_LOG_LIMIT } from '../services/auditLog.service';
import { toPublicAuditLog } from '../views/auditLog.view';
import { AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/**
 * An unrecognised filter value is REFUSED, never ignored — the same rule as
 * every other filter in this API (D-041). An ignored filter returns a full,
 * confident, wrong answer, which in an audit view is the worst possible
 * failure: it looks like "no such actions happened".
 */
const asEnumFilter = <T extends Record<string, string>>(
  value: unknown,
  allowed: T,
  label: string,
): T[keyof T] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !Object.values(allowed).includes(value)) {
    throw invalid(`« ${label} » doit être l'un de : ${Object.values(allowed).join(', ')}.`);
  }
  return value as T[keyof T];
};

/** GET /api/v1/audit-logs — UC-04, Administrateur only */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const { items, total } = await listAuditLogs({
      action: asEnumFilter(req.query.action, AuditAction, 'action'),
      targetType: asEnumFilter(req.query.targetType, AuditTargetType, 'targetType'),
    });

    // Bare array + count header, like every other list endpoint (D-041). The
    // total matters here beyond consistency: it is how an administrator can
    // tell the 50 rows they are looking at are not the whole story.
    res.setHeader('X-Total-Count', total);
    res.setHeader('X-Page-Limit', AUDIT_LOG_LIMIT);
    res.status(200).json(items.map(toPublicAuditLog));
  } catch (error) {
    next(error);
  }
};

import { RequestHandler } from 'express';
import {
  listNotifications,
  markNotificationRead,
  deleteNotification,
  DEFAULT_NOTIFICATION_LIMIT,
  MAX_NOTIFICATION_LIMIT,
} from '../services/notification.service';
import { toPublicNotification } from '../views/notification.view';
import { AppError } from '../common/errors';

const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);

/** Request-shape checks only; the rules live in the service (Section 2). */
const asBoundedInt = (
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(`« ${label} » doit être un entier positif.`);
  }
  const parsed = Number(value);
  // Refused, not clamped: see D-041.
  if (parsed < min || parsed > max) {
    throw invalid(`« ${label} » doit être compris entre ${min} et ${max}.`);
  }
  return parsed;
};

/** Tri-state: absent means "all". "false" is a truthy string, hence the check. */
const asOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'true' && value !== 'false') {
    throw invalid(`« ${label} » doit valoir « true » ou « false ».`);
  }
  return value === 'true';
};

/** GET /api/v1/notifications — FR-43 */
export const list: RequestHandler = async (req, res, next) => {
  try {
    const { isRead, limit, offset } = req.query;

    const { items, total } = await listNotifications({
      viewer: req.currentUser!,
      isRead: asOptionalBoolean(isRead, 'isRead'),
      limit: asBoundedInt(limit, 'limit', DEFAULT_NOTIFICATION_LIMIT, 1, MAX_NOTIFICATION_LIMIT),
      offset: asBoundedInt(offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
    });

    // Bare array + count header, like every other list endpoint (D-041).
    res.setHeader('X-Total-Count', total);
    res.status(200).json(items.map(toPublicNotification));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/v1/notifications/:id/read — FR-43 */
export const markRead: RequestHandler = async (req, res, next) => {
  try {
    const notification = await markNotificationRead(String(req.params.id), req.currentUser!);
    res.status(200).json(toPublicNotification(notification));
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/v1/notifications/:id — FR-44 (D-054, outside the Section 9 contract) */
export const remove: RequestHandler = async (req, res, next) => {
  try {
    await deleteNotification(String(req.params.id), req.currentUser!);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

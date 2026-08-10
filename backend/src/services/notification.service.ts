import { Types } from 'mongoose';
import { Notification, INotification } from '../models/Notification.model';
import { IUser } from '../models/User.model';
import { AppError } from '../common/errors';

/**
 * FR-43 / FR-44 — the notification panel.
 *
 * D-054 fixes three things this file exists to enforce:
 *
 *  - A user only ever reaches their OWN notifications. The scope comes from
 *    the session, never from the request.
 *  - A notification that is not yours returns 404, not 403. This is the one
 *    place D-027's "prefer 403" resolution is deliberately inverted: a 403 on
 *    /notifications/:id would confirm that a given id exists and belongs to
 *    some other named user, which is an enumeration leak with no compensating
 *    clarity — the caller has no legitimate reason to tell "not yours" from
 *    "not there".
 *  - No role restriction beyond authentication: all three roles receive
 *    notifications (FR-40 recruiter + responsable, FR-41 recruiter, FR-42
 *    responsable), so the panel is open to any authenticated user.
 *
 * The 404 property is enforced BY CONSTRUCTION rather than by an `if`: every
 * single-document operation below filters on `{ _id, userId }` in one query,
 * so the two cases are literally the same code path and cannot drift apart.
 */
const notFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', "Cette notification n'existe pas.");

/** Pagination bounds follow D-041, like every other list endpoint. */
export const DEFAULT_NOTIFICATION_LIMIT = 25;
export const MAX_NOTIFICATION_LIMIT = 100;

export interface ListNotificationsInput {
  viewer: IUser;
  isRead?: boolean;
  limit: number;
  offset: number;
}

export interface ListNotificationsResult {
  items: INotification[];
  total: number;
}

/**
 * FR-43 — the panel list, newest first.
 *
 * Paginated for a reason particular to this module: FR-44 forbids any expiry,
 * so a user's notification collection grows without bound for the life of the
 * account. Every other list here is naturally bounded by the business (open
 * positions, scheduled interviews); this one is not.
 *
 * `isRead` is a tri-state filter — omitted means "all", matching the
 * `isActive` filter on GET /users (FR-12). `isRead=false` with the
 * `X-Total-Count` header is also how the unread badge in user story 33 gets
 * its number, without a second endpoint.
 *
 * No `sortBy` whitelist: a notification panel is newest-first, always. The
 * model's `{ userId: 1, createdAt: -1 }` index serves exactly this query.
 */
export const listNotifications = async (
  input: ListNotificationsInput,
): Promise<ListNotificationsResult> => {
  const query: Record<string, unknown> = { userId: input.viewer._id };

  if (input.isRead !== undefined) {
    query.isRead = input.isRead;
  }

  const [items, total] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip(input.offset).limit(input.limit),
    Notification.countDocuments(query),
  ]);

  return { items, total };
};

/**
 * FR-43 — mark one notification as read.
 *
 * Idempotent: marking an already-read notification read again is a 200, not a
 * conflict. Re-reading something is not an error worth failing a click over,
 * the same reasoning as D-026's idempotent logout.
 */
export const markNotificationRead = async (
  id: string,
  viewer: IUser,
): Promise<INotification> => {
  if (!Types.ObjectId.isValid(id)) {
    throw notFound();
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: id, userId: viewer._id },
    { isRead: true },
    { new: true },
  );

  if (!notification) {
    throw notFound();
  }
  return notification;
};

/**
 * FR-44 — manual deletion, the only way a notification ever leaves the system.
 *
 * NOT idempotent: deleting an already-deleted notification is a 404, which is
 * the same answer as deleting someone else's. That is the point — the two are
 * indistinguishable, which is exactly the property D-054 asks for.
 */
export const deleteNotification = async (id: string, viewer: IUser): Promise<void> => {
  if (!Types.ObjectId.isValid(id)) {
    throw notFound();
  }

  const deleted = await Notification.findOneAndDelete({ _id: id, userId: viewer._id });

  if (!deleted) {
    throw notFound();
  }
};

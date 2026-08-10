import { INotification } from '../models/Notification.model';
import { NotificationType } from '../common/constants';

/** The "V" of MVC (D-003): the JSON shape a Notification takes on the way out. */
export interface PublicNotification {
  id: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * `userId` is deliberately absent: every notification a caller can reach is
 * their own by construction (D-054 scopes from the session, never the query),
 * so echoing the recipient back would only be a field a client could start
 * filtering on client-side.
 */
export const toPublicNotification = (notification: INotification): PublicNotification => ({
  id: String(notification._id),
  type: notification.type,
  message: notification.message,
  isRead: notification.isRead,
  createdAt: notification.createdAt.toISOString(),
});

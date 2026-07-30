import { Schema, model, Document, Types } from 'mongoose';
import { NotificationType } from '../common/constants';

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  // FR-40 to FR-42: recipient of the notification
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  type: { type: String, required: true, enum: Object.values(NotificationType) },

  message: { type: String, required: true, trim: true },

  // FR-43: read/unread state, toggled by the user
  isRead: { type: Boolean, required: true, default: false },

  // FR-44: notifications survive until the user deletes them manually.
  // Deliberately NO TTL index here — an expiry would silently violate FR-44.
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
});

// FR-43: the panel lists one user's notifications, newest first.
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);

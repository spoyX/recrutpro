import { Schema, model, Document, Types } from 'mongoose';
import { Role, EMAIL_PATTERN } from '../common/constants';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  departmentId?: Types.ObjectId;
  isActive: boolean;
  mustChangePassword: boolean;
}

const userSchema = new Schema<IUser>({
  // FR-6: nom complet
  name: { type: String, required: true, trim: true },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [EMAIL_PATTERN, 'Adresse email invalide'],
  },

  // NFR-03 / ARCHITECTURE.md rule 3: bcrypt hash, never returned in any API
  // response. select:false keeps it out of query results unless explicitly
  // requested by the auth service.
  passwordHash: { type: String, required: true, select: false },

  role: { type: String, required: true, enum: Object.values(Role) },

  // FR-6. Required for the two department-scoped roles: a Recruteur or
  // Responsable hiérarchique without a department would break the
  // server-side department scoping in ARCHITECTURE.md rule 2.
  // Administrateur is global and has none.
  departmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Department',
    required: function (this: IUser): boolean {
      return this.role === Role.Recruteur || this.role === Role.ResponsableHierarchique;
    },
  },

  // FR-8 / FR-9: deactivate blocks login, reactivate restores it
  isActive: { type: Boolean, required: true, default: true },

  // FR-10: set when an admin resets the password, forcing a change at next login
  mustChangePassword: { type: Boolean, required: true, default: false },
});

export const User = model<IUser>('User', userSchema);

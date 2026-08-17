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
  avatarPublicId?: string;
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

  // D-091 / D-092 — the profile image. The Cloudinary handle, and ONLY the
  // handle.
  //
  // *** DO NOT ADD AN `avatarUrl` FIELD BESIDE THIS ONE. *** D-091 ratified
  // exactly that, mirroring `Resume.fileUrl`, and D-092 removed it: for
  // `resource_type: 'image'`, an `authenticated` asset's `secure_url` embeds a
  // signature that NEVER EXPIRES, so the stored value was a working,
  // unauthenticated, permanent link to an employee's face. Verified by fetching
  // it with no credentials — HTTP 200. The same test against a resume returns
  // 401, because `raw` needs a full download token, so D-040's identical claim
  // holds for CVs and failed only here.
  //
  // Nothing read the field either: delivery signs a 60-second URL from this
  // handle. See D-092 for the general warning — matching an existing decision's
  // code shape says nothing about its security property when the
  // `resource_type` differs.
  //
  // NEVER RETURNED TO A CLIENT. `GET /users/:id/avatar` proxies the bytes
  // behind requireAuth, and the `avatarUrl` in an API RESPONSE is this API's
  // own proxy path — a different thing entirely, and unambiguous precisely
  // because no field of that name exists here.
  avatarPublicId: { type: String, trim: true },
});

export const User = model<IUser>('User', userSchema);

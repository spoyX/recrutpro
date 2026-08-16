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

  // D-091 — the profile image. The Cloudinary handle, and ONLY the handle.
  //
  // *** THE STORED `secure_url` WAS DROPPED AFTER LIVE VERIFICATION, and the
  // reason is worth keeping. *** D-091 was ratified with an `avatarUrl` field
  // beside this one, mirroring `Resume.fileUrl`. Fetching that stored URL with
  // no credentials at all returned **HTTP 200**: for `resource_type: 'image'`,
  // Cloudinary's `secure_url` for an `authenticated` asset embeds a signature
  // that is PERMANENTLY valid, so the value was a working, never-expiring
  // public link to an employee's face sitting at rest in the database.
  //
  // The same test against a resume returns 401 — `raw` authenticated assets
  // need a full download token, so D-040's identical claim is true for CVs and
  // was false only for images. The precedent was sound; copying it here was not.
  //
  // Nothing ever read the field: delivery signs a 60-second URL from this
  // handle instead. So it was pure liability, and removing it costs nothing.
  //
  // NEVER RETURNED TO A CLIENT. `GET /users/:id/avatar` proxies the bytes
  // behind requireAuth, and the `avatarUrl` in an API RESPONSE is this API's
  // own proxy path — a different thing entirely, and now unambiguous, since no
  // field of that name exists here any more.
  avatarPublicId: { type: String, trim: true },
});

export const User = model<IUser>('User', userSchema);

import { Types } from 'mongoose';
import { User, IUser } from '../models/User.model';
import { AppError } from '../common/errors';
import {
  cloudinary,
  isCloudinaryConfigured,
  AVATAR_UPLOAD_OPTIONS,
  AVATAR_CONTENT_TYPE,
} from '../config/cloudinary';
import { assertImageSignature } from '../middleware/upload.middleware';

/**
 * D-091 — profile images (Phase 4.3).
 *
 * A near-copy of `resume.service.ts` on purpose: the security shape is the
 * same one D-040 settled, and the two files should stay recognisably alike so
 * a change to one prompts a look at the other. The differences are the three
 * D-091 records — `image` rather than `raw`, a 2MB cap, and a cacheable proxy
 * response — plus one that matters more than any of them:
 *
 * *** THERE IS NO AUTHORISATION DECISION IN THIS FILE. ***
 *
 * `downloadResume` has to decide whether THIS viewer may see THIS candidate's
 * CV (FR-35 / D-047). An avatar has no equivalent question: every authenticated
 * user may see any colleague's photo, and the two write paths are reachable
 * only through `/users/me/...`, so they cannot address anyone else. The
 * absence is deliberate and is the reason the routes are shaped that way —
 * see the note in `user.routes.ts`.
 */

const assertConfigured = (): void => {
  if (!isCloudinaryConfigured) {
    throw new AppError(
      503,
      'STORAGE_UNAVAILABLE',
      "Le stockage des images n'est pas configuré sur ce serveur. Contactez l'administrateur.",
    );
  }
};

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
}

const uploadBuffer = (buffer: Buffer): Promise<{ public_id: string }> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(AVATAR_UPLOAD_OPTIONS, (error, result) => {
      if (error || !result) {
        // Cloudinary's own error text is not surfaced to the client (NFR-04).
        reject(
          new AppError(
            502,
            'STORAGE_ERROR',
            "L'image n’a pas pu être enregistrée. Réessayez dans un instant.",
          ),
        );
        return;
      }
      resolve({ public_id: result.public_id });
    });
    stream.end(buffer);
  });

/**
 * Best-effort remote delete, the same trade `resume.service.ts` makes: a
 * Cloudinary failure must not fail a replacement that has already succeeded.
 * Worst case is one orphaned asset, which beats refusing a valid upload.
 */
const destroyAsset = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: AVATAR_UPLOAD_OPTIONS.resource_type,
      type: AVATAR_UPLOAD_OPTIONS.type,
      invalidate: true,
    });
  } catch {
    console.warn('[cloudinary] suppression de l’ancienne photo impossible', publicId);
  }
};

/**
 * D-091 — set the caller's own profile image.
 *
 * `viewer` is the session user reloaded by requireAuth (D-027), never an id
 * from the request, so there is no path by which this writes to another
 * account.
 *
 * Order is the same as D-040's and for the same reason: every local check runs
 * before a single byte reaches Cloudinary. Cloudinary is storage, never the
 * security boundary.
 */
export const setAvatar = async (viewer: IUser, file: UploadedFile | undefined): Promise<IUser> => {
  if (!file) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Aucun fichier reçu. Joignez une image JPEG, PNG ou WebP dans le champ « file ».',
    );
  }

  assertConfigured();

  // D-007: content check, not extension. Runs BEFORE the upload call.
  assertImageSignature(file.buffer, file.mimetype);

  const uploaded = await uploadBuffer(file.buffer);

  // D-091: replacing DESTROYS the previous asset — the deliberate opposite of
  // FR-22, which preserves a replaced CV because a requirement says so. The
  // old handle is read before the new one overwrites it.
  const previousPublicId = viewer.avatarPublicId;

  // The handle only. Cloudinary also hands back a `secure_url`; storing it was
  // the ratified design (D-091) until a live check fetched that value with no
  // credentials and got 200, and D-092 removed it. Delivery signs a short-lived
  // URL from the handle, so the stored URL was never needed in the first place.
  const user = await User.findByIdAndUpdate(
    viewer._id,
    { avatarPublicId: uploaded.public_id },
    { new: true },
  );
  if (!user) {
    // Only reachable if the account was deleted mid-request. Nothing deletes
    // users (FR-8 deactivates), so this is a fail-closed guard.
    throw new AppError(404, 'NOT_FOUND', "Ce compte n'existe plus.");
  }

  if (previousPublicId) {
    await destroyAsset(previousPublicId);
  }

  return user;
};

/**
 * D-091 — remove the caller's own photo, restoring the initials fallback.
 *
 * Idempotent: removing a photo that is not there is not an error worth failing
 * a workflow over, and the end state the caller asked for is the end state
 * they get. (Contrast `closeJobPosition`, which reports re-closing — there the
 * second call means the caller believes something about a shared record that
 * is no longer true.)
 */
export const removeAvatar = async (viewer: IUser): Promise<IUser> => {
  const publicId = viewer.avatarPublicId;

  const user = await User.findByIdAndUpdate(
    viewer._id,
    { $unset: { avatarPublicId: '' } },
    { new: true },
  );
  if (!user) {
    throw new AppError(404, 'NOT_FOUND', "Ce compte n'existe plus.");
  }

  // The row is cleared FIRST. If the remote delete fails the photo is already
  // unreachable through this API, which is what the caller asked for; the
  // reverse order could leave a cleared asset still referenced by a live row.
  if (publicId) {
    await destroyAsset(publicId);
  }

  return user;
};

/**
 * D-091 — the bytes of a user's profile image.
 *
 * D-040's proxy, unchanged in substance: the backend fetches the asset itself
 * with a short-lived signed URL and returns the buffer. The client never
 * receives a Cloudinary URL, so a photo cannot be reached without passing this
 * route's requireAuth first.
 */
export const downloadAvatar = async (
  userId: string,
): Promise<{ buffer: Buffer; contentType: string }> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new AppError(404, 'NOT_FOUND', "Ce compte n'existe pas.");
  }

  const user = await User.findById(userId, 'avatarPublicId');
  if (!user) {
    throw new AppError(404, 'NOT_FOUND', "Ce compte n'existe pas.");
  }
  if (!user.avatarPublicId) {
    // Not an error state: most accounts have no photo, and the client renders
    // initials instead. A 404 is the honest answer for "there is no image
    // here" and lets the browser cache the absence.
    throw new AppError(404, 'NOT_FOUND', "Ce compte n'a pas de photo de profil.");
  }

  assertConfigured();

  // 60 seconds is generous for a server-to-server fetch and the URL never
  // leaves this process.
  const signedUrl = cloudinary.utils.private_download_url(user.avatarPublicId, 'jpg', {
    resource_type: AVATAR_UPLOAD_OPTIONS.resource_type,
    type: AVATAR_UPLOAD_OPTIONS.type,
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });

  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError(
      502,
      'STORAGE_ERROR',
      'L’image n’a pas pu être récupérée. Réessayez dans un instant.',
    );
  }

  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: AVATAR_CONTENT_TYPE };
};

import { v2 as cloudinary } from 'cloudinary';

/**
 * D-040 — Cloudinary is the resume store. Credentials come from the
 * environment only, exactly like MONGO_URI and SESSION_SECRET: never
 * hardcoded, never logged, never returned in a response.
 */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

export const isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
} else {
  // Named, never valued. The rest of the app still boots — only the resume
  // routes refuse, with a 503 that says what is missing (NFR-09).
  console.warn(
    '[cloudinary] non configuré — CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / ' +
      'CLOUDINARY_API_SECRET absents. Les routes de CV renverront 503.',
  );
}

/**
 * Resumes are uploaded as `authenticated`, so Cloudinary exposes NO publicly
 * readable URL for them. Delivery is possible only through a signed URL the
 * backend generates itself, which is what makes the FR-23 proxy the single
 * way to reach a CV (D-040).
 *
 * `raw` rather than `image`: a PDF uploaded as an image would be processed and
 * transformable, which is not wanted for a document that must come back byte
 * for byte.
 */
export const RESUME_UPLOAD_OPTIONS = {
  folder: 'recrutpro/resumes',
  resource_type: 'raw',
  type: 'authenticated',
} as const;

/**
 * D-091 — profile images. Same `authenticated` delivery as a resume, so no
 * publicly readable URL exists and the FR-23-style proxy is the only way in.
 *
 * THREE DELIBERATE DIFFERENCES from RESUME_UPLOAD_OPTIONS above:
 *
 *  - `resource_type: 'image'`, not `'raw'`. A resume is `raw` precisely so it
 *    comes back byte for byte with no processing. Here the opposite is wanted.
 *  - An eager transformation normalises the upload to a 256px square. A 2MB
 *    phone photo is otherwise re-served at full size into a 32px circle.
 *    `gravity: 'face'` keeps the head in frame when the crop is not centred.
 *  - `format: 'jpg'`, so whatever came in (JPEG, PNG or WebP) leaves as one
 *    known type. The proxy can then declare a single Content-Type instead of
 *    tracking what each user happened to upload.
 */
export const AVATAR_UPLOAD_OPTIONS = {
  folder: 'recrutpro/avatars',
  resource_type: 'image',
  type: 'authenticated',
  format: 'jpg',
  transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }],
} as const;

/** What `AVATAR_UPLOAD_OPTIONS.format` guarantees every stored avatar is. */
export const AVATAR_CONTENT_TYPE = 'image/jpeg';

export { cloudinary };

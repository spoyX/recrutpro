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

export { cloudinary };

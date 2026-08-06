import { Types } from 'mongoose';
import { Resume, IResume } from '../models/Resume.model';
import { Candidate, ICandidate } from '../models/Candidate.model';
import { AppError } from '../common/errors';
import { cloudinary, isCloudinaryConfigured, RESUME_UPLOAD_OPTIONS } from '../config/cloudinary';
import { assertResumeSignature } from '../middleware/upload.middleware';

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const assertConfigured = (): void => {
  if (!isCloudinaryConfigured) {
    throw new AppError(
      503,
      'STORAGE_UNAVAILABLE',
      "Le stockage des CV n'est pas configuré sur ce serveur. Contactez l'administrateur.",
    );
  }
};

const findCandidateOr404 = async (candidateId: string): Promise<ICandidate> => {
  if (!Types.ObjectId.isValid(candidateId)) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw new AppError(404, 'NOT_FOUND', "Ce candidat n'existe pas.");
  }
  return candidate;
};

/** D-016: at most one active resume per candidate. */
export const findActiveResume = (candidateId: string): Promise<IResume | null> =>
  Resume.findOne({ candidateId, isActive: true });

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

const uploadBuffer = (buffer: Buffer, mimeType: string): Promise<{ secure_url: string; public_id: string }> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { ...RESUME_UPLOAD_OPTIONS, format: EXTENSIONS[mimeType] },
      (error, result) => {
        if (error || !result) {
          // Cloudinary's own error text is not surfaced to the client (NFR-04).
          reject(
            new AppError(
              502,
              'STORAGE_ERROR',
              'Le CV n’a pas pu être enregistré. Réessayez dans un instant.',
            ),
          );
          return;
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );
    stream.end(buffer);
  });

/**
 * FR-21 / FR-22 — store a CV, replacing any previous one.
 *
 * Order matters and is deliberate: EVERY validation runs locally, and the
 * candidate is confirmed to exist, before a single byte reaches Cloudinary
 * (D-040). Cloudinary is storage, never the security boundary.
 */
export const uploadResumeForCandidate = async (
  candidateId: string,
  file: UploadedFile | undefined,
): Promise<IResume> => {
  if (!file) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Aucun fichier reçu. Joignez un CV au format PDF ou DOCX dans le champ « file ».',
    );
  }

  await findCandidateOr404(candidateId);
  assertConfigured();

  // D-007: content check, not extension. Runs BEFORE the upload call.
  assertResumeSignature(file.buffer, file.mimetype);

  const uploaded = await uploadBuffer(file.buffer, file.mimetype);

  // FR-22: the previous CV stops being reachable. The Cloudinary asset is
  // destroyed AND the row is flipped inactive — deleting the remote file alone
  // would leave a row pointing at nothing, and flipping the row alone would
  // orphan the file in Cloudinary for good.
  const previous = await findActiveResume(candidateId);
  if (previous) {
    await destroyAsset(previous.publicId);
    previous.isActive = false;
    await previous.save();
  }

  return Resume.create({
    candidateId,
    fileUrl: uploaded.secure_url,
    publicId: uploaded.public_id,
    isActive: true,
  });
};

/**
 * Best-effort remote delete. A Cloudinary failure here must not fail the
 * upload that already succeeded — the new CV is in place and the row is about
 * to be deactivated either way, so the worst case is one orphaned asset, which
 * is strictly better than refusing a valid replacement.
 */
const destroyAsset = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: RESUME_UPLOAD_OPTIONS.resource_type,
      type: RESUME_UPLOAD_OPTIONS.type,
      invalidate: true,
    });
  } catch {
    console.warn('[cloudinary] suppression de l’ancien CV impossible', publicId);
  }
};

/**
 * FR-23 — the bytes of a candidate's current CV.
 *
 * D-040: the backend fetches the asset itself with a short-lived signed URL
 * and returns the buffer. The client never receives a Cloudinary URL, so a CV
 * cannot be reached without passing this route's RBAC first.
 */
export const downloadResume = async (
  candidateId: string,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> => {
  await findCandidateOr404(candidateId);
  assertConfigured();

  const resume = await findActiveResume(candidateId);
  if (!resume) {
    throw new AppError(404, 'NOT_FOUND', "Aucun CV n'a été téléversé pour ce candidat.");
  }

  // 60 seconds is generous for a server-to-server fetch and the URL never
  // leaves this process.
  const signedUrl = cloudinary.utils.private_download_url(
    resume.publicId,
    resume.publicId.endsWith('.docx') ? 'docx' : 'pdf',
    {
      resource_type: RESUME_UPLOAD_OPTIONS.resource_type,
      type: RESUME_UPLOAD_OPTIONS.type,
      expires_at: Math.floor(Date.now() / 1000) + 60,
    },
  );

  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError(
      502,
      'STORAGE_ERROR',
      'Le CV n’a pas pu être récupéré. Réessayez dans un instant.',
    );
  }

  const isDocx = resume.publicId.endsWith('.docx');
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: isDocx
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf',
    filename: `cv-${candidateId}.${isDocx ? 'docx' : 'pdf'}`,
  };
};

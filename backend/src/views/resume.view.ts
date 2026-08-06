import { IResume } from '../models/Resume.model';

/**
 * The "V" of MVC (D-003).
 *
 * D-040: neither `fileUrl` nor `publicId` appears here. A Cloudinary
 * reference must never reach a client — the only way to a CV is the
 * backend's own download route, which enforces RBAC first.
 */
export interface PublicResume {
  id: string;
  candidateId: string;
  uploadedAt: string;
  isActive: boolean;
  downloadUrl: string;
}

export const toPublicResume = (resume: IResume): PublicResume => ({
  id: String(resume._id),
  candidateId: String(resume.candidateId),
  uploadedAt: resume.uploadedAt.toISOString(),
  isActive: resume.isActive,
  downloadUrl: `/api/v1/candidates/${String(resume.candidateId)}/resume`,
});

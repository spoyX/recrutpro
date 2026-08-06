import { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { AppError } from '../common/errors';

/** FR-21 — 5 Mo. */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** FR-21 — PDF and DOCX only. */
export const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/**
 * D-007 — the file is validated by its CONTENT, never by its extension.
 *
 * memoryStorage (D-040): the upload lives as a Buffer and never touches the
 * filesystem, which is both what rule 5 wants and what lets the signature
 * check below run before a single byte reaches Cloudinary.
 */
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First gate only. The declared MIME type is client-supplied and trivially
    // faked, so it is necessary but never sufficient — assertResumeSignature
    // is what actually decides.
    if (!(ALLOWED_RESUME_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(
        new AppError(
          400,
          'UNSUPPORTED_FILE_TYPE',
          'Seuls les fichiers PDF et DOCX sont acceptés. Choisissez un fichier dans un de ces formats.',
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single('file');

const startsWith = (buffer: Buffer, signature: number[]): boolean =>
  buffer.length >= signature.length && signature.every((byte, i) => buffer[i] === byte);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — DOCX is a ZIP

/**
 * D-007 — magic-byte validation. This is the check that stops a renamed
 * executable: a .exe declared as application/pdf passes the extension and the
 * MIME gate, and dies here.
 *
 * DOCX is a ZIP container, so the ZIP signature alone would also accept any
 * .zip, .jar or .xlsx. A real DOCX always stores "[Content_Types].xml" and a
 * "word/" entry, and ZIP local file headers keep entry names in plain text, so
 * scanning the buffer for those markers separates a DOCX from an arbitrary
 * archive without unzipping anything.
 *
 * ponytail: substring scan rather than parsing the ZIP central directory. It
 * cannot be fooled by a renamed binary, which is the threat rule 5 names; a
 * hand-crafted archive carrying those literal strings would pass. Parse the
 * central directory if that ever matters.
 */
export const assertResumeSignature = (buffer: Buffer, declaredMimeType: string): void => {
  const rejected = (): never => {
    throw new AppError(
      400,
      'INVALID_FILE_CONTENT',
      "Le contenu du fichier ne correspond pas à un document PDF ou DOCX valide. " +
        'Vérifiez que le fichier n’est pas corrompu et que son extension n’a pas été modifiée.',
    );
  };

  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Le fichier est vide. Sélectionnez un CV à téléverser.');
  }

  if (declaredMimeType === 'application/pdf') {
    if (!startsWith(buffer, PDF_SIGNATURE)) {
      rejected();
    }
    return;
  }

  // DOCX
  if (!startsWith(buffer, ZIP_SIGNATURE)) {
    rejected();
  }
  const asLatin1 = buffer.toString('latin1');
  if (!asLatin1.includes('[Content_Types].xml') || !asLatin1.includes('word/')) {
    rejected();
  }
};

/**
 * Wraps multer so its own errors become the Section 9 {error:{code,message}}
 * shape instead of multer's, and so an oversized upload is reported as such.
 */
export const uploadResume: RequestHandler = (req, res, next) => {
  memoryUpload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            400,
            'FILE_TOO_LARGE',
            'Le fichier dépasse la taille maximale de 5 Mo. Compressez-le ou choisissez un fichier plus petit.',
          ),
        );
        return;
      }
      next(new AppError(400, 'INVALID_UPLOAD', `Téléversement invalide : ${error.message}.`));
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
};

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

// ---------------------------------------------------------------------------
// D-091 — profile images. Same three-gate discipline as above, different
// constants: a smaller cap, an image allowlist, and image signatures.
// ---------------------------------------------------------------------------

/** D-091 — 2 Mo. A normalised 256px avatar has no honest reason to be larger. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * D-091 — JPEG, PNG and WebP.
 *
 * SVG IS EXCLUDED ON PURPOSE and must not be added. It is a document format
 * that can carry `<script>`, and unlike the three above there is no magic-byte
 * test that makes it safe to serve back — an SVG is valid XML whatever it
 * contains. GIF is left out simply because nothing needs it.
 */
export const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(
        new AppError(
          400,
          'UNSUPPORTED_FILE_TYPE',
          'Seules les images JPEG, PNG et WebP sont acceptées. Choisissez une image dans un de ces formats.',
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single('file');

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"

/**
 * D-007 applied to images — the content decides, never the extension.
 *
 * WebP needs two checks, not one: the container is RIFF, which is also AVI and
 * WAV, so the four bytes at offset 8 must spell "WEBP". Checking "RIFF" alone
 * would accept an audio file declared as an image.
 */
export const assertImageSignature = (buffer: Buffer, declaredMimeType: string): void => {
  const rejected = (): never => {
    throw new AppError(
      400,
      'INVALID_FILE_CONTENT',
      "Le contenu du fichier ne correspond pas à une image JPEG, PNG ou WebP valide. " +
        'Vérifiez que le fichier n’est pas corrompu et que son extension n’a pas été modifiée.',
    );
  };

  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Le fichier est vide. Sélectionnez une image.');
  }

  if (declaredMimeType === 'image/jpeg') {
    if (!startsWith(buffer, JPEG_SIGNATURE)) {
      rejected();
    }
    return;
  }

  if (declaredMimeType === 'image/png') {
    if (!startsWith(buffer, PNG_SIGNATURE)) {
      rejected();
    }
    return;
  }

  // WebP
  if (!startsWith(buffer, RIFF_SIGNATURE) || buffer.toString('latin1', 8, 12) !== 'WEBP') {
    rejected();
  }
};

/** Same error translation as `uploadResume`, with the avatar's own limit. */
export const uploadAvatar: RequestHandler = (req, res, next) => {
  avatarUpload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(
            400,
            'FILE_TOO_LARGE',
            "L'image dépasse la taille maximale de 2 Mo. Choisissez une image plus légère.",
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

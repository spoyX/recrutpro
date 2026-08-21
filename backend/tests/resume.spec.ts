import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Resume } from '../src/models/Resume.model';
import { Interview } from '../src/models/Interview.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { cloudinary } from '../src/config/cloudinary';
import { assertResumeSignature, MAX_RESUME_BYTES } from '../src/middleware/upload.middleware';
import { Role } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/Resume.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/JobPosition.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedResume = Resume as unknown as { create: jest.Mock; findOne: jest.Mock };
const mockedInterview = Interview as unknown as { exists: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const RESUME_ID = new Types.ObjectId().toString();
const UPLOADED_AT = new Date('2026-08-06T10:00:00.000Z');

const DEPT_ID = new Types.ObjectId().toString();

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
};

const admin = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'admin@example.com', role: Role.Administrateur };

/** A minimal but REAL PDF: correct signature followed by body bytes. */
const pdfBuffer = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from('1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
]);

/** A DOCX is a ZIP carrying these two markers. */
const docxBuffer = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....[Content_Types].xml....word/document.xml....'),
]);

/** A Windows executable renamed to .pdf — the exact D-007 threat. */
const exeBuffer = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x90)]);

let uploadStreamSpy: jest.SpyInstance;
let destroySpy: jest.SpyInstance;

const signInAs = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  mockedUser.findById.mockResolvedValue(who);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

let cookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  loginRateLimitStore.resetAll?.();

  mockedCandidate.findById.mockResolvedValue({
    _id: CANDIDATE_ID,
    jobPositionId: new Types.ObjectId().toString(),
  });
  // FR-35 defaults: the candidate's position is in the Responsable's
  // department, and they ARE assigned an interview with them.
  mockedJobPosition.findById.mockResolvedValue({ department: DEPT_ID });
  mockedInterview.exists.mockResolvedValue({ _id: 'an-interview' });
  mockedResume.findOne.mockResolvedValue(null);
  mockedResume.create.mockResolvedValue({
    _id: RESUME_ID,
    candidateId: CANDIDATE_ID,
    publicId: 'recrutpro/resumes/abc.pdf',
    uploadedAt: UPLOADED_AT,
    isActive: true,
  });

  // The SDK is stubbed: these tests prove OUR validation runs before it, and
  // that it is called correctly — not that Cloudinary works.
  uploadStreamSpy = jest
    .spyOn(cloudinary.uploader, 'upload_stream')
    .mockImplementation(((_opts: unknown, callback: (e: unknown, r: unknown) => void) => {
      const stream = {
        end: () => {
          callback(null, {
            secure_url: 'https://res.cloudinary.com/demo/raw/authenticated/s--sig--/recrutpro/resumes/abc.pdf',
            public_id: 'recrutpro/resumes/abc.pdf',
          });
        },
      };
      return stream;
    }) as never);

  destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' } as never);

  cookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const upload = (buffer: Buffer, filename: string, contentType: string) =>
  request(app)
    .post(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
    .set('Cookie', cookie)
    .attach('file', buffer, { filename, contentType });

describe('Resume upload / replace / download — FR-21 to FR-23', () => {
  describe('FR-21: upload', () => {
    it('FR-21: accepts a valid PDF', async () => {
      const res = await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(201);
      expect(uploadStreamSpy).toHaveBeenCalledTimes(1);
    });

    it('FR-21: accepts a valid DOCX', async () => {
      const res = await upload(
        docxBuffer,
        'cv.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

      expect(res.status).toBe(201);
    });

    it('FR-21 / D-040: the stored document keeps the Cloudinary public_id', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(mockedResume.create).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateId: CANDIDATE_ID,
          publicId: 'recrutpro/resumes/abc.pdf',
          isActive: true,
        }),
      );
    });

    it('D-040: uploads are authenticated + raw, so no public URL exists', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(uploadStreamSpy.mock.calls[0][0]).toMatchObject({
        type: 'authenticated',
        resource_type: 'raw',
      });
    });

    it('D-040: NO Cloudinary reference is returned to the client', async () => {
      const res = await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('cloudinary');
      expect(body).not.toContain('recrutpro/resumes');
      expect(res.body.downloadUrl).toBe(`/api/v1/candidates/${CANDIDATE_ID}/resume`);
    });

    it('FR-21: a missing file is rejected', async () => {
      const res = await request(app)
        .post(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('FR-21: an unknown candidate is a 404, and nothing is uploaded', async () => {
      mockedCandidate.findById.mockResolvedValue(null);

      const res = await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(404);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });
  });

  describe('D-007: validation happens HERE, before any upload', () => {
    it('D-007: a renamed executable declared as PDF is rejected', async () => {
      const res = await upload(exeBuffer, 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_CONTENT');
      // The point of the whole exercise: it never reached the store.
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('D-007: a disallowed MIME type is rejected before the body is read', async () => {
      const res = await upload(Buffer.from('#!/bin/sh\n'), 'cv.sh', 'application/x-sh');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('FR-21: a file over 5 MB is rejected', async () => {
      const tooBig = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_RESUME_BYTES, 0x41)]);

      const res = await upload(tooBig, 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('D-007: an empty file is rejected', async () => {
      const res = await upload(Buffer.alloc(0), 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(400);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('D-007: a plain ZIP declared as DOCX is rejected', async () => {
      // A DOCX is a ZIP, so the archive signature alone is not enough.
      const plainZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('hello.txt')]);

      const res = await upload(
        plainZip,
        'cv.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

      expect(res.status).toBe(400);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('D-007: the signature check is a pure function that throws', () => {
      expect(() => assertResumeSignature(pdfBuffer, 'application/pdf')).not.toThrow();
      expect(() => assertResumeSignature(exeBuffer, 'application/pdf')).toThrow();
    });
  });

  describe('FR-22: replacing a resume', () => {
    const previous = {
      _id: new Types.ObjectId().toString(),
      publicId: 'recrutpro/resumes/old.pdf',
      isActive: true,
      save: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
      previous.isActive = true;
      previous.save.mockClear();
      mockedResume.findOne.mockResolvedValue(previous);
    });

    it('FR-22: the previous Cloudinary asset is deleted, not orphaned', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(destroySpy).toHaveBeenCalledWith('recrutpro/resumes/old.pdf', expect.anything());
    });

    it('FR-22 / D-016: the previous row is flipped inactive', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(previous.isActive).toBe(false);
      expect(previous.save).toHaveBeenCalled();
    });

    it('FR-22: a replacement still creates exactly one new active row', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(mockedResume.create).toHaveBeenCalledTimes(1);
      expect(mockedResume.create.mock.calls[0][0].isActive).toBe(true);
    });

    it('FR-22: a failed remote delete does not fail a valid replacement', async () => {
      destroySpy.mockRejectedValue(new Error('cloudinary down'));

      const res = await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      expect(res.status).toBe(201);
      expect(previous.isActive).toBe(false);
    });

    it('FR-22: the OLD asset is deleted only after the NEW upload succeeds', async () => {
      await upload(pdfBuffer, 'cv.pdf', 'application/pdf');

      const uploadOrder = uploadStreamSpy.mock.invocationCallOrder[0];
      const destroyOrder = destroySpy.mock.invocationCallOrder[0];
      // Otherwise a failed upload would leave the candidate with no CV at all.
      expect(destroyOrder).toBeGreaterThan(uploadOrder);
    });
  });

  describe('FR-23: download', () => {
    beforeEach(() => {
      mockedResume.findOne.mockResolvedValue({
        _id: RESUME_ID,
        candidateId: CANDIDATE_ID,
        publicId: 'recrutpro/resumes/abc.pdf',
        uploadedAt: UPLOADED_AT,
        isActive: true,
      });
    });

    it('FR-23 / D-040: the file is PROXIED, never redirected', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfBuffer.buffer.slice(0) as ArrayBuffer,
      } as never);

      const res = await request(app)
        .get(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      // A 3xx here would mean the client, not the backend, talks to the store.
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('FR-23 / D-040: the signed URL never leaves the server', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfBuffer.buffer.slice(0) as ArrayBuffer,
      } as never);

      const res = await request(app)
        .get(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', cookie);

      expect(JSON.stringify(res.headers)).not.toContain('cloudinary');
    });

    it('FR-23: a candidate with no CV is a 404', async () => {
      mockedResume.findOne.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', cookie);

      expect(res.status).toBe(404);
    });
  });

  describe('FR-35 / D-047: the Responsable reaches only their own candidates’ CVs', () => {
    const responsable = {
      ...recruteur,
      _id: new Types.ObjectId().toString(),
      email: 'pierre@example.com',
      role: Role.ResponsableHierarchique,
      departmentId: DEPT_ID,
    };

    const download = async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        arrayBuffer: async () => pdfBuffer.buffer.slice(0) as ArrayBuffer,
      } as never);
      mockedResume.findOne.mockResolvedValue({
        _id: RESUME_ID,
        candidateId: CANDIDATE_ID,
        publicId: 'recrutpro/resumes/abc.pdf',
        uploadedAt: UPLOADED_AT,
        isActive: true,
      });
      const responsableCookie = await signInAs(responsable);
      return request(app)
        .get(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', responsableCookie);
    };

    it('FR-35: CAN download the CV of a candidate they interview', async () => {
      const res = await download();

      expect(res.status).toBe(200);
    });

    it('D-047: CANNOT download when no interview is assigned to them', async () => {
      mockedInterview.exists.mockResolvedValue(null);

      const res = await download();

      expect(res.status).toBe(403);
    });

    it('D-047: CANNOT download across departments, even when assigned', async () => {
      // rule 2's floor: the department clause is independent of assignment.
      mockedJobPosition.findById.mockResolvedValue({
        department: new Types.ObjectId().toString(),
      });

      const res = await download();

      expect(res.status).toBe(403);
    });

    it('D-047: the check runs against the LOADED candidate, not the URL', async () => {
      mockedInterview.exists.mockResolvedValue(null);

      await download();

      // exists() is called with the real candidate _id and the session user.
      expect(mockedInterview.exists).toHaveBeenCalledWith({
        candidateId: CANDIDATE_ID,
        interviewerId: responsable._id,
      });
    });

    it('D-047: a Responsable still cannot UPLOAD a CV', async () => {
      const responsableCookie = await signInAs(responsable);

      const res = await request(app)
        .post(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', responsableCookie)
        .attach('file', pdfBuffer, { filename: 'cv.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(403);
    });

    it('D-047: a Responsable still cannot list candidates', async () => {
      const responsableCookie = await signInAs(responsable);

      const res = await request(app).get('/api/v1/candidates').set('Cookie', responsableCookie);

      expect(res.status).toBe(403);
    });
  });

  describe('FR-5: RBAC governs both routes', () => {
    it('FR-5: an unauthenticated upload is rejected', async () => {
      const res = await request(app)
        .post(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .attach('file', pdfBuffer, { filename: 'cv.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(401);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('FR-5: an unauthenticated download is rejected', async () => {
      const res = await request(app).get(`/api/v1/candidates/${CANDIDATE_ID}/resume`);

      expect(res.status).toBe(401);
    });

    it('FR-5: a non-Recruteur cannot upload', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app)
        .post(`/api/v1/candidates/${CANDIDATE_ID}/resume`)
        .set('Cookie', adminCookie)
        .attach('file', pdfBuffer, { filename: 'cv.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(403);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });
  });
});

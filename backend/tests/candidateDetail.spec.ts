import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Resume } from '../src/models/Resume.model';
import { Interview } from '../src/models/Interview.model';
import { InterviewEvaluation } from '../src/models/InterviewEvaluation.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Role, CandidateStage, InterviewStatus } from '../src/common/constants';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/Resume.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/InterviewEvaluation.model');
jest.mock('../src/models/JobPosition.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedResume = Resume as unknown as { exists: jest.Mock };
const mockedInterview = Interview as unknown as { find: jest.Mock; exists: jest.Mock };
const mockedEvaluation = InterviewEvaluation as unknown as { find: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);

const DEPARTMENT_ID = new Types.ObjectId().toString();
const OTHER_DEPARTMENT_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const RECRUTEUR_ID = new Types.ObjectId().toString();
const RESPONSABLE_ID = new Types.ObjectId().toString();
const OLD_INTERVIEW_ID = new Types.ObjectId().toString();
const NEW_INTERVIEW_ID = new Types.ObjectId().toString();

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: DEPARTMENT_ID,
  isActive: true,
  mustChangePassword: false,
};
const responsable = {
  ...recruteur,
  _id: RESPONSABLE_ID,
  name: 'Pierre',
  email: 'pierre@example.com',
  role: Role.ResponsableHierarchique,
};
const admin = {
  ...recruteur,
  _id: new Types.ObjectId().toString(),
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined,
};

/**
 * The candidate document. `populate()` is the Mongoose DOCUMENT method the
 * service calls after authorising, so the mock swaps the raw refs for
 * populated ones exactly as Mongoose would — which is what lets a test prove
 * the authorisation check ran against the RAW id (see the FR-35 cases).
 */
const makeCandidate = (overrides: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    email: 'jean.martin@example.com',
    phone: '0612345678',
    jobPositionId: POSITION_ID,
    currentStage: CandidateStage.Accepte,
    registeredBy: RECRUTEUR_ID,
    registeredAt: new Date('2026-08-01T09:00:00.000Z'),
    decidedAt: new Date('2026-08-11T17:30:00.000Z'),
    rejectionReason: undefined,
    decisionComment: 'Excellent profil, offre envoyée.',
    ...overrides,
  };
  doc.populate = jest.fn().mockImplementation(async () => {
    doc.jobPositionId = { _id: POSITION_ID, title: 'Développeur backend' };
    doc.registeredBy = { _id: RECRUTEUR_ID, name: 'Marie' };
    return doc;
  });
  return doc;
};

const interviewRow = (id: string, scheduledAt: string, overrides: Record<string, unknown> = {}) => ({
  _id: id,
  candidateId: CANDIDATE_ID,
  interviewerId: { _id: RESPONSABLE_ID, name: 'Pierre' },
  scheduledAt: new Date(scheduledAt),
  status: InterviewStatus.Realise,
  cancellationReason: undefined,
  ...overrides,
});

const evaluationRow = (interviewId: string) => ({
  _id: new Types.ObjectId().toString(),
  interviewId,
  scores: { technicalSkills: 4, communication: 5, overallFit: 4 },
  comments: 'Très bonne maîtrise technique.',
  submittedBy: { _id: RESPONSABLE_ID, name: 'Pierre' },
});

const signInAs = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  mockedUser.findById.mockResolvedValue(who);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

/** Interview.find(...).populate(...).sort(...) */
let interviewChain: { populate: jest.Mock; sort: jest.Mock };

const setInterviews = (rows: unknown[]): void => {
  interviewChain = {
    populate: jest.fn(),
    sort: jest.fn().mockResolvedValue(rows),
  };
  interviewChain.populate.mockReturnValue(interviewChain);
  mockedInterview.find.mockReturnValue(interviewChain);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  mockedCandidate.findById.mockResolvedValue(makeCandidate());
  setInterviews([
    interviewRow(NEW_INTERVIEW_ID, '2026-08-10T14:00:00.000Z'),
    interviewRow(OLD_INTERVIEW_ID, '2026-08-05T09:00:00.000Z', {
      status: InterviewStatus.Annule,
      cancellationReason: 'Candidat indisponible.',
    }),
  ]);
  mockedEvaluation.find.mockReturnValue({
    populate: jest.fn().mockResolvedValue([evaluationRow(NEW_INTERVIEW_ID)]),
  });
  mockedResume.exists.mockResolvedValue({ _id: new Types.ObjectId().toString() });
  // hasAssignedInterviewWith's two reads — the position's department, then
  // whether an interview links this candidate to this viewer.
  mockedJobPosition.findById.mockResolvedValue({ _id: POSITION_ID, department: DEPARTMENT_ID });
  mockedInterview.exists.mockResolvedValue({ _id: NEW_INTERVIEW_ID });
});

const get = (cookie: string[]) =>
  request(app).get(`/api/v1/candidates/${CANDIDATE_ID}`).set('Cookie', cookie);

describe('GET /candidates/:id — Candidate Details (D-067)', () => {
  describe('FR-5 — access control is server-side (NFR-04)', () => {
    it('FR-5: refuses an anonymous caller with 401', async () => {
      const res = await request(app).get(`/api/v1/candidates/${CANDIDATE_ID}`);
      expect(res.status).toBe(401);
      expect(mockedCandidate.findById).not.toHaveBeenCalled();
    });

    it('FR-5: refuses an Administrateur with 403 — no FR grants them a candidate file', async () => {
      const cookie = await signInAs(admin);
      const res = await get(cookie);
      expect(res.status).toBe(403);
      expect(mockedCandidate.findById).not.toHaveBeenCalled();
    });
  });

  describe('Recruteur — the whole file', () => {
    it('D-067: returns the candidate, position, registrant and decision in one payload', async () => {
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: CANDIDATE_ID,
        fullName: 'Jean Martin',
        email: 'jean.martin@example.com',
        phone: '0612345678',
        jobPosition: { id: POSITION_ID, title: 'Développeur backend' },
        currentStage: CandidateStage.Accepte,
        registeredBy: { id: RECRUTEUR_ID, name: 'Marie' },
        registeredAt: '2026-08-01T09:00:00.000Z',
        decidedAt: '2026-08-11T17:30:00.000Z',
        decisionComment: 'Excellent profil, offre envoyée.',
        rejectionReason: null,
      });
    });

    it('FR-23 / D-040: offers the CV through this API proxy route, never a storage URL', async () => {
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.body.resume).toEqual({
        hasResume: true,
        url: `/api/v1/candidates/${CANDIDATE_ID}/resume`,
      });
      expect(JSON.stringify(res.body)).not.toContain('cloudinary');
    });

    it('FR-22: a candidate with no ACTIVE resume gets hasResume false and NO url', async () => {
      mockedResume.exists.mockResolvedValue(null);
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.body.resume).toEqual({ hasResume: false, url: null });
    });

    it('FR-22: only an ACTIVE resume counts, so a replaced CV does not read as downloadable', async () => {
      const cookie = await signInAs(recruteur);
      await get(cookie);

      expect(mockedResume.exists).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });
  });

  describe('FR-34 / FR-36 — the interview history', () => {
    it('D-067: lists every interview NEWEST FIRST — a history reads backwards', async () => {
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(interviewChain.sort).toHaveBeenCalledWith({ scheduledAt: -1 });
      expect(res.body.interviews.map((i: { id: string }) => i.id)).toEqual([
        NEW_INTERVIEW_ID,
        OLD_INTERVIEW_ID,
      ]);
    });

    it('FR-34: a cancelled interview keeps its row and carries its motive', async () => {
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.body.interviews[1]).toMatchObject({
        status: InterviewStatus.Annule,
        cancellationReason: 'Candidat indisponible.',
      });
    });

    it('FR-36: the evaluation hangs off ITS OWN interview, not the first row', async () => {
      // The evaluation belongs to the NEWER interview; the older, cancelled one
      // has none. A top-level `evaluation` field could not express this.
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.body.interviews[0].evaluation).toMatchObject({
        scores: { technicalSkills: 4, communication: 5, overallFit: 4 },
        comments: 'Très bonne maîtrise technique.',
        submittedBy: { id: RESPONSABLE_ID, name: 'Pierre' },
      });
      expect(res.body.interviews[1].evaluation).toBeNull();
    });

    it('D-067: fetches all evaluations in ONE query, not one per interview', async () => {
      const cookie = await signInAs(recruteur);
      await get(cookie);

      expect(mockedEvaluation.find).toHaveBeenCalledTimes(1);
      expect(mockedEvaluation.find).toHaveBeenCalledWith({
        interviewId: { $in: [NEW_INTERVIEW_ID, OLD_INTERVIEW_ID] },
      });
    });

    it('D-067: a candidate with no interviews gets an empty array, never null', async () => {
      setInterviews([]);
      mockedEvaluation.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.status).toBe(200);
      expect(res.body.interviews).toEqual([]);
    });
  });

  describe('FR-35 / D-047 — the Responsable hiérarchique sees only their own', () => {
    it('FR-35: an ASSIGNED responsable in the right department gets the file', async () => {
      const cookie = await signInAs(responsable);
      const res = await get(cookie);

      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('Jean Martin');
      expect(res.body.jobPosition.title).toBe('Développeur backend');
    });

    it('FR-35: contact details are NULL for a responsable — FR-35 grants name, poste and CV only', async () => {
      const cookie = await signInAs(responsable);
      const res = await get(cookie);

      expect(res.body.email).toBeNull();
      expect(res.body.phone).toBeNull();
      // The CV access FR-35 DOES grant is still there.
      expect(res.body.resume.hasResume).toBe(true);
    });

    it('FR-35: a responsable with NO interview for this candidate is refused 403', async () => {
      mockedInterview.exists.mockResolvedValue(null);
      const cookie = await signInAs(responsable);
      const res = await get(cookie);

      expect(res.status).toBe(403);
    });

    it('rule 2: a responsable outside the position department is refused, even with an interview', async () => {
      mockedJobPosition.findById.mockResolvedValue({
        _id: POSITION_ID,
        department: OTHER_DEPARTMENT_ID,
      });
      const cookie = await signInAs(responsable);
      const res = await get(cookie);

      expect(res.status).toBe(403);
    });

    it('rule 2: the department check reads the RAW position id, not a populated object', async () => {
      // Authorisation must not depend on Mongoose casting a sub-document, so
      // the candidate is loaded unpopulated and enriched only after the gate.
      const cookie = await signInAs(responsable);
      await get(cookie);

      expect(mockedJobPosition.findById).toHaveBeenCalledWith(POSITION_ID, 'department');
    });

    it('FR-5: the Recruteur is NOT department-scoped and skips the assignment check', async () => {
      mockedInterview.exists.mockResolvedValue(null);
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.status).toBe(200);
      expect(mockedJobPosition.findById).not.toHaveBeenCalled();
    });
  });

  describe('Not found', () => {
    it('404s an unknown candidate', async () => {
      mockedCandidate.findById.mockResolvedValue(null);
      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('404s a malformed id rather than surfacing a cast error', async () => {
      const cookie = await signInAs(recruteur);
      const res = await request(app).get('/api/v1/candidates/not-an-id').set('Cookie', cookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(mockedCandidate.findById).not.toHaveBeenCalled();
    });
  });

  describe('Null-tolerance', () => {
    it('D-067: an unpopulated registrant becomes null, not a nameless object', async () => {
      const candidate = makeCandidate();
      // A ref that never resolved — the row must not render an empty label.
      (candidate.populate as jest.Mock).mockImplementation(async () => {
        candidate.jobPositionId = { _id: POSITION_ID, title: 'Développeur backend' };
        return candidate;
      });
      mockedCandidate.findById.mockResolvedValue(candidate);

      const cookie = await signInAs(recruteur);
      const res = await get(cookie);

      expect(res.status).toBe(200);
      expect(res.body.registeredBy).toBeNull();
    });
  });
});

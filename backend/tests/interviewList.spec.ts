import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Interview } from '../src/models/Interview.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Resume } from '../src/models/Resume.model';
import { Role, InterviewStatus } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/Resume.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { find: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { find: jest.Mock };
const mockedResume = Resume as unknown as { find: jest.Mock };
const mockedInterview = Interview as unknown as { find: jest.Mock; countDocuments: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const INTERVIEWER_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const INTERVIEW_ID = new Types.ObjectId().toString();

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: new Types.ObjectId().toString(),
  isActive: true,
  mustChangePassword: false,
};
const admin = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'admin@example.com', role: Role.Administrateur };
const responsable = { ...recruteur, _id: INTERVIEWER_ID, email: 'pierre@example.com', role: Role.ResponsableHierarchique };

const row = {
  _id: INTERVIEW_ID,
  scheduledAt: new Date('2026-09-01T09:00:00.000Z'),
  status: InterviewStatus.Planifie,
  candidateId: {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    jobPositionId: { _id: POSITION_ID, title: 'Développeur backend' },
  },
  interviewerId: { _id: INTERVIEWER_ID, name: 'Pierre' },
};

let chain: { populate: jest.Mock; sort: jest.Mock; skip: jest.Mock; limit: jest.Mock };

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
  loginRateLimitStore.resetAll?.();

  chain = {
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn().mockResolvedValue([row]),
  };
  chain.populate.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);

  mockedInterview.find.mockReturnValue(chain);
  mockedInterview.countDocuments.mockResolvedValue(1);
  mockedCandidate.find.mockResolvedValue([{ _id: CANDIDATE_ID }]);
  mockedJobPosition.find.mockResolvedValue([{ _id: POSITION_ID }]);
  mockedResume.find.mockResolvedValue([]);

  cookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const list = (qs = '') => request(app).get(`/api/v1/interviews${qs}`).set('Cookie', cookie);

describe('Interview list — FR-33', () => {
  describe('FR-33: the row shape', () => {
    it('FR-33: returns candidate, poste and responsable, not bare ids', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body[0]).toEqual({
        id: INTERVIEW_ID,
        scheduledAt: '2026-09-01T09:00:00.000Z',
        status: InterviewStatus.Planifie,
        candidate: {
          id: CANDIDATE_ID,
          fullName: 'Jean Martin',
          hasResume: false,
          resumeUrl: `/api/v1/candidates/${CANDIDATE_ID}/resume`,
        },
        jobPosition: { id: POSITION_ID, title: 'Développeur backend' },
        interviewer: { id: INTERVIEWER_ID, name: 'Pierre' },
        cancellationReason: null,
      });
    });

    it('FR-33: the total rides in X-Total-Count (D-041 convention)', async () => {
      mockedInterview.countDocuments.mockResolvedValue(42);

      const res = await list();

      expect(res.headers['x-total-count']).toBe('42');
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('FR-33: a row with an unresolved candidate still serialises', async () => {
      chain.limit.mockResolvedValue([{ ...row, candidateId: null }]);

      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body[0].candidate).toBeNull();
      expect(res.body[0].jobPosition).toBeNull();
    });
  });

  describe('D-045 / D-049: finished interviews are hidden by default', () => {
    it('D-045: the default list is "Planifié" only', async () => {
      await list();

      expect(mockedInterview.find).toHaveBeenCalledWith({ status: InterviewStatus.Planifie });
    });

    it('D-049: includeFinished=true returns every status', async () => {
      await list('?includeFinished=true');

      expect(mockedInterview.find).toHaveBeenCalledWith({});
    });

    it('D-049: the default hides BOTH Annulé and Réalisé', async () => {
      // The rename exists because the single status:Planifié filter excludes
      // two finished states, not just cancellation.
      await list();

      const status = mockedInterview.find.mock.calls[0][0].status;
      expect(status).toBe(InterviewStatus.Planifie);
      expect(status).not.toBe(InterviewStatus.Annule);
      expect(status).not.toBe(InterviewStatus.Realise);
    });

    it('D-049: includeFinished=false is explicit, not truthy-string', async () => {
      // "false" is a truthy string — the classic silent inversion.
      await list('?includeFinished=false');

      expect(mockedInterview.find).toHaveBeenCalledWith({ status: InterviewStatus.Planifie });
    });

    it('D-049: a non-boolean includeFinished is a 400', async () => {
      const res = await list('?includeFinished=maybe');

      expect(res.status).toBe(400);
      expect(mockedInterview.find).not.toHaveBeenCalled();
    });

    it('D-049: the OLD includeCancelled name is no longer honoured', async () => {
      // It must not silently keep working, or callers would never migrate.
      await list('?includeCancelled=true');

      expect(mockedInterview.find).toHaveBeenCalledWith({ status: InterviewStatus.Planifie });
    });
  });

  describe('FR-33: filters', () => {
    it('FR-33: filters by responsable hiérarchique', async () => {
      await list(`?interviewerId=${INTERVIEWER_ID}`);

      expect(mockedInterview.find.mock.calls[0][0].interviewerId).toBe(INTERVIEWER_ID);
    });

    it('FR-33: filters by date range', async () => {
      await list('?fromDate=2026-09-01&toDate=2026-09-30');

      const q = mockedInterview.find.mock.calls[0][0];
      expect(q.scheduledAt.$gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(q.scheduledAt.$lte.toISOString()).toBe('2026-09-30T23:59:59.999Z');
    });

    it('FR-33 / D-041: a date-only toDate covers the whole day', async () => {
      await list('?toDate=2026-09-01');

      const to = mockedInterview.find.mock.calls[0][0].scheduledAt.$lte as Date;
      expect(to.toISOString()).toBe('2026-09-01T23:59:59.999Z');
    });

    it('FR-33 / D-045: filtering by poste resolves candidate ids first', async () => {
      await list(`?jobPositionId=${POSITION_ID}`);

      // Interview holds candidateId; the position lives on the Candidate.
      expect(mockedJobPosition.find).toHaveBeenCalledWith({ _id: POSITION_ID }, '_id');
      expect(mockedInterview.find.mock.calls[0][0].candidateId).toEqual({ $in: [CANDIDATE_ID] });
    });

    it('FR-33: a poste with no candidates yields an empty $in, not everything', async () => {
      mockedCandidate.find.mockResolvedValue([]);

      await list(`?jobPositionId=${POSITION_ID}`);

      expect(mockedInterview.find.mock.calls[0][0].candidateId).toEqual({ $in: [] });
    });

    it('FR-33: filters combine', async () => {
      await list(`?interviewerId=${INTERVIEWER_ID}&jobPositionId=${POSITION_ID}&fromDate=2026-09-01`);

      const q = mockedInterview.find.mock.calls[0][0];
      expect(q.interviewerId).toBe(INTERVIEWER_ID);
      expect(q.candidateId).toBeDefined();
      expect(q.scheduledAt.$gte).toBeDefined();
    });
  });

  describe('FR-33 / D-041: bad input is refused, never ignored', () => {
    const refuses = (qs: string) =>
      it(`FR-33: ${qs} is a 400`, async () => {
        const res = await list(qs);

        expect(res.status).toBe(400);
        expect(mockedInterview.find).not.toHaveBeenCalled();
      });

    refuses('?interviewerId=not-an-id');
    refuses('?jobPositionId=not-an-id');
    refuses('?fromDate=demain');
    refuses('?toDate=2026-13-45');
    refuses('?limit=0');
    refuses('?limit=101');
    refuses('?offset=-1');
    refuses('?sortBy=passwordHash');
    refuses('?sortDir=sideways');
    refuses('?fromDate=2026-10-01&toDate=2026-09-01');
  });

  describe('FR-33: pagination and sorting', () => {
    it('FR-33: defaults to 25 from offset 0', async () => {
      await list();

      expect(chain.limit).toHaveBeenCalledWith(25);
      expect(chain.skip).toHaveBeenCalledWith(0);
    });

    it('FR-33: honours limit and offset', async () => {
      await list('?limit=5&offset=10');

      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(chain.skip).toHaveBeenCalledWith(10);
    });

    it('FR-33: a schedule reads FORWARD by default', async () => {
      // Unlike the candidate list, which is newest-first.
      await list();

      expect(chain.sort).toHaveBeenCalledWith({ scheduledAt: 1, _id: 1 });
    });

    it('FR-33: sortDir=desc reverses it', async () => {
      await list('?sortDir=desc');

      expect(chain.sort).toHaveBeenCalledWith({ scheduledAt: -1, _id: 1 });
    });

    it('FR-33: sorts by status', async () => {
      await list('?sortBy=status');

      expect(chain.sort).toHaveBeenCalledWith({ status: 1, _id: 1 });
      // D-069: the tiebreaker matters MOST here — `status` has three distinct
      // values, so without it paging duplicates and drops rows.
      expect(Object.keys(chain.sort.mock.calls.at(-1)![0]).at(-1)).toBe('_id');
    });

    it('FR-33: the count uses the same filter, before pagination', async () => {
      await list(`?interviewerId=${INTERVIEWER_ID}&limit=1`);

      expect(mockedInterview.countDocuments).toHaveBeenCalledWith({
        status: InterviewStatus.Planifie,
        interviewerId: INTERVIEWER_ID,
      });
    });
  });

  describe('FR-5: Recruteur only — FR-35 will cover the Responsable', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/v1/interviews');

      expect(res.status).toBe(401);
      expect(mockedInterview.find).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur is 403', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app).get('/api/v1/interviews').set('Cookie', adminCookie);

      expect(res.status).toBe(403);
    });

    it('FR-35: a Responsable hiérarchique CAN now read this list', async () => {
      // FR-33 gave them a 403; that was "their FR hasn't landed", not a rule.
      const responsableCookie = await signInAs(responsable);

      const res = await request(app).get('/api/v1/interviews').set('Cookie', responsableCookie);

      expect(res.status).toBe(200);
    });
  });

  describe('FR-35 / D-047: the Responsable sees ONLY their own assigned interviews', () => {
    const asResponsable = async (qs = '') => {
      const responsableCookie = await signInAs(responsable);
      return request(app).get(`/api/v1/interviews${qs}`).set('Cookie', responsableCookie);
    };

    it('FR-35: the query is pinned to their own interviewerId', async () => {
      await asResponsable();

      expect(mockedInterview.find.mock.calls[0][0].interviewerId).toBe(INTERVIEWER_ID);
    });

    it('D-047: rule 2 department floor is applied ON TOP of the assignment', async () => {
      await asResponsable();

      // The two-hop join: positions in my department -> their candidates.
      expect(mockedJobPosition.find).toHaveBeenCalledWith(
        { department: responsable.departmentId },
        '_id',
      );
      expect(mockedInterview.find.mock.calls[0][0].candidateId).toBeDefined();
    });

    it("D-047: asking for someone else's interviews is REFUSED, not silently rewritten", async () => {
      // Overwriting the filter is safe but hands back the caller's OWN list —
      // a confidently wrong answer. Live verification caught exactly that.
      const someoneElse = new Types.ObjectId().toString();

      const res = await asResponsable(`?interviewerId=${someoneElse}`);

      expect(res.status).toBe(403);
      expect(mockedInterview.find).not.toHaveBeenCalled();
    });

    it('D-047: filtering by their OWN interviewerId is allowed', async () => {
      const res = await asResponsable(`?interviewerId=${INTERVIEWER_ID}`);

      expect(res.status).toBe(200);
      expect(mockedInterview.find.mock.calls[0][0].interviewerId).toBe(INTERVIEWER_ID);
    });

    it('D-047: a Responsable CANNOT reach another department via ?jobPositionId', async () => {
      const foreignPosition = new Types.ObjectId().toString();

      await asResponsable(`?jobPositionId=${foreignPosition}`);

      // Both clauses present: the requested position AND my department, so a
      // foreign position resolves to no candidates rather than to its own.
      expect(mockedJobPosition.find).toHaveBeenCalledWith(
        { _id: foreignPosition, department: responsable.departmentId },
        '_id',
      );
    });

    it('FR-33: a Recruteur is NOT scoped', async () => {
      await list();

      expect(mockedInterview.find.mock.calls[0][0].interviewerId).toBeUndefined();
      expect(mockedInterview.find.mock.calls[0][0].candidateId).toBeUndefined();
    });

    it('D-045: the Responsable default also hides cancelled interviews', async () => {
      await asResponsable();

      expect(mockedInterview.find.mock.calls[0][0].status).toBe(InterviewStatus.Planifie);
    });

    it('FR-35: includeFinished still works for them', async () => {
      await asResponsable('?includeFinished=true');

      expect(mockedInterview.find.mock.calls[0][0].status).toBeUndefined();
    });
  });

  describe('FR-35: the row carries CV access', () => {
    it('FR-35: hasResume is true when the candidate has an active CV', async () => {
      mockedResume.find.mockResolvedValue([{ candidateId: CANDIDATE_ID }]);

      const res = await list();

      expect(res.body[0].candidate.hasResume).toBe(true);
    });

    it('FR-35: resumeUrl points at OUR proxy, never at storage (D-040)', async () => {
      const res = await list();

      expect(res.body[0].candidate.resumeUrl).toBe(`/api/v1/candidates/${CANDIDATE_ID}/resume`);
      expect(JSON.stringify(res.body)).not.toContain('cloudinary');
    });

    it('FR-35: hasResume counts only ACTIVE resumes', async () => {
      await list();

      expect(mockedResume.find.mock.calls[0][0]).toMatchObject({ isActive: true });
    });

    it('FR-35: CV lookup is ONE query for the page, not one per row', async () => {
      await list();

      expect(mockedResume.find).toHaveBeenCalledTimes(1);
    });
  });
});

import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Resume } from '../src/models/Resume.model';
import { Role, CandidateStage } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/Resume.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { find: jest.Mock; countDocuments: jest.Mock };
const mockedResume = Resume as unknown as { find: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const WITH_RESUME_ID = new Types.ObjectId().toString();
const WITHOUT_RESUME_ID = new Types.ObjectId().toString();

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
const responsable = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'pierre@example.com', role: Role.ResponsableHierarchique };

const candidateRow = (id: string, fullName: string) => ({
  _id: id,
  fullName,
  email: `${fullName.toLowerCase().replace(' ', '.')}@example.com`,
  phone: '0612345678',
  jobPositionId: { _id: POSITION_ID, title: 'Développeur backend' },
  currentStage: CandidateStage.CandidatureRecue,
  registeredBy: RECRUTEUR_ID,
  registeredAt: new Date('2026-08-05T10:00:00.000Z'),
});

/** Captures the chained query so each stage can be asserted on. */
let chain: {
  populate: jest.Mock;
  sort: jest.Mock;
  skip: jest.Mock;
  limit: jest.Mock;
};

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

  const rows = [
    candidateRow(WITH_RESUME_ID, 'Jean Martin'),
    candidateRow(WITHOUT_RESUME_ID, 'Alice Durand'),
  ];

  chain = {
    populate: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn().mockResolvedValue(rows),
  };
  chain.populate.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);

  mockedCandidate.find.mockReturnValue(chain);
  mockedCandidate.countDocuments.mockResolvedValue(2);
  // Only the first candidate has an active CV.
  mockedResume.find.mockResolvedValue([{ candidateId: WITH_RESUME_ID }]);

  cookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const list = (qs = '') => request(app).get(`/api/v1/candidates${qs}`).set('Cookie', cookie);

describe('Candidate list — FR-24', () => {
  describe('FR-24: the row shape', () => {
    it('FR-24: returns the fields the list needs', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({
        id: WITH_RESUME_ID,
        fullName: 'Jean Martin',
        email: 'jean.martin@example.com',
        phone: '0612345678',
        jobPosition: { id: POSITION_ID, title: 'Développeur backend' },
        currentStage: CandidateStage.CandidatureRecue,
        registeredAt: '2026-08-05T10:00:00.000Z',
        hasResume: true,
      });
    });

    it('FR-24: the job position TITLE is populated, not just its id', async () => {
      await list();

      expect(chain.populate).toHaveBeenCalledWith('jobPositionId', 'title');
    });

    it('FR-24: hasResume is false when the candidate has no active CV', async () => {
      const res = await list();

      expect(res.body[1].hasResume).toBe(false);
    });

    it('FR-24: hasResume counts only ACTIVE resumes', async () => {
      // FR-22 leaves replaced rows behind; a stale one must not read as a CV.
      await list();

      expect(mockedResume.find.mock.calls[0][0]).toMatchObject({ isActive: true });
    });

    it('FR-24 / D-041: hasResume costs ONE query, not one per row', async () => {
      await list();

      expect(mockedResume.find).toHaveBeenCalledTimes(1);
      expect(mockedResume.find.mock.calls[0][0].candidateId.$in).toHaveLength(2);
    });

    it('FR-24: a row whose position vanished still serialises', async () => {
      chain.limit.mockResolvedValue([{ ...candidateRow(WITH_RESUME_ID, 'Orphan'), jobPositionId: null }]);

      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body[0].jobPosition).toBeNull();
    });
  });

  describe('FR-24: filters', () => {
    it('FR-24: no filter queries everything', async () => {
      await list();

      expect(mockedCandidate.find).toHaveBeenCalledWith({});
    });

    it('FR-24: filters by job position', async () => {
      await list(`?jobPositionId=${POSITION_ID}`);

      expect(mockedCandidate.find).toHaveBeenCalledWith({ jobPositionId: POSITION_ID });
    });

    it('FR-24: filters by pipeline stage', async () => {
      await list(`?currentStage=${encodeURIComponent(CandidateStage.CandidatureRecue)}`);

      expect(mockedCandidate.find).toHaveBeenCalledWith({
        currentStage: CandidateStage.CandidatureRecue,
      });
    });

    it('FR-24: filters by registration date range', async () => {
      await list('?fromDate=2026-08-01&toDate=2026-08-31');

      const query = mockedCandidate.find.mock.calls[0][0];
      expect(query.registeredAt.$gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(query.registeredAt.$lte.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    });

    it('FR-24 / D-041: a date-only toDate covers the WHOLE day', async () => {
      // The trap: midnight would exclude everyone registered that day.
      await list('?toDate=2026-08-06');

      const to = mockedCandidate.find.mock.calls[0][0].registeredAt.$lte as Date;
      expect(to.toISOString()).toBe('2026-08-06T23:59:59.999Z');
    });

    it('FR-24: a full timestamp toDate is honoured as given', async () => {
      await list('?toDate=2026-08-06T09:30:00.000Z');

      const to = mockedCandidate.find.mock.calls[0][0].registeredAt.$lte as Date;
      expect(to.toISOString()).toBe('2026-08-06T09:30:00.000Z');
    });

    it('FR-24: filters combine', async () => {
      await list(`?jobPositionId=${POSITION_ID}&currentStage=${encodeURIComponent(CandidateStage.CandidatureRecue)}&fromDate=2026-08-01`);

      const query = mockedCandidate.find.mock.calls[0][0];
      expect(query.jobPositionId).toBe(POSITION_ID);
      expect(query.currentStage).toBe(CandidateStage.CandidatureRecue);
      expect(query.registeredAt.$gte).toBeDefined();
    });
  });

  describe('FR-24 / D-041: bad input is refused, never silently ignored', () => {
    const refuses = (qs: string) =>
      it(`FR-24: ${qs} is a 400`, async () => {
        const res = await list(qs);

        expect(res.status).toBe(400);
        // The decisive part: no query ran, so no misleading list came back.
        expect(mockedCandidate.find).not.toHaveBeenCalled();
      });

    refuses('?currentStage=Peut-être');
    refuses('?jobPositionId=not-an-id');
    refuses('?fromDate=hier');
    refuses('?toDate=2026-13-45');
    refuses('?limit=0');
    refuses('?limit=101');
    refuses('?limit=abc');
    refuses('?limit=-5');
    refuses('?offset=-1');
    refuses('?sortBy=passwordHash');
    refuses('?sortDir=sideways');
    refuses('?fromDate=2026-09-01&toDate=2026-08-01');
  });

  describe('FR-24 / D-041: pagination', () => {
    it('FR-24: defaults to 25 rows from offset 0', async () => {
      await list();

      expect(chain.limit).toHaveBeenCalledWith(25);
      expect(chain.skip).toHaveBeenCalledWith(0);
    });

    it('FR-24: honours limit and offset', async () => {
      await list('?limit=10&offset=40');

      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(chain.skip).toHaveBeenCalledWith(40);
    });

    it('FR-24: the total match count is exposed in X-Total-Count', async () => {
      mockedCandidate.countDocuments.mockResolvedValue(137);

      const res = await list('?limit=2');

      expect(res.headers['x-total-count']).toBe('137');
      expect(res.body).toHaveLength(2);
    });

    it('FR-24: the count is taken BEFORE pagination, with the same filter', async () => {
      await list(`?jobPositionId=${POSITION_ID}&limit=1`);

      expect(mockedCandidate.countDocuments).toHaveBeenCalledWith({ jobPositionId: POSITION_ID });
    });
  });

  describe('FR-24: sorting', () => {
    it('FR-24: defaults to newest first', async () => {
      await list();

      expect(chain.sort).toHaveBeenCalledWith({ registeredAt: -1 });
    });

    it('FR-24: sorts by fullName ascending', async () => {
      await list('?sortBy=fullName&sortDir=asc');

      expect(chain.sort).toHaveBeenCalledWith({ fullName: 1 });
    });

    it('FR-24: sorts by currentStage', async () => {
      await list('?sortBy=currentStage&sortDir=desc');

      expect(chain.sort).toHaveBeenCalledWith({ currentStage: -1 });
    });

    it('FR-24: sorts by registeredAt ascending', async () => {
      await list('?sortBy=registeredAt&sortDir=asc');

      expect(chain.sort).toHaveBeenCalledWith({ registeredAt: 1 });
    });
  });

  describe('FR-5: Recruteur only', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/v1/candidates');

      expect(res.status).toBe(401);
      expect(mockedCandidate.find).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur is 403', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app).get('/api/v1/candidates').set('Cookie', adminCookie);

      expect(res.status).toBe(403);
      expect(mockedCandidate.find).not.toHaveBeenCalled();
    });

    it('FR-5: a Responsable hiérarchique is 403', async () => {
      const responsableCookie = await signInAs(responsable);

      const res = await request(app).get('/api/v1/candidates').set('Cookie', responsableCookie);

      expect(res.status).toBe(403);
    });
  });
});

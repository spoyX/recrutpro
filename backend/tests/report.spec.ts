import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Role, CandidateStage, JobPositionStatus } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/JobPosition.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { aggregate: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { find: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);

const DEPT_A = new Types.ObjectId().toString();
const DEPT_B = new Types.ObjectId().toString();
const POS_A1 = new Types.ObjectId().toString();
const POS_A2 = new Types.ObjectId().toString();
const POS_B1 = new Types.ObjectId().toString();

const base = { name: 'X', passwordHash, isActive: true, mustChangePassword: false };
const marie = {
  ...base,
  _id: new Types.ObjectId().toString(),
  email: 'marie@example.com',
  role: Role.Recruteur,
  departmentId: DEPT_A,
};
const pierre = {
  ...base,
  _id: new Types.ObjectId().toString(),
  email: 'pierre@example.com',
  role: Role.ResponsableHierarchique,
  departmentId: DEPT_A,
};
const sofia = {
  ...base,
  _id: new Types.ObjectId().toString(),
  email: 'sofia@example.com',
  role: Role.ResponsableHierarchique,
  departmentId: DEPT_B,
};
const admin = {
  ...base,
  _id: new Types.ObjectId().toString(),
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined,
};

/** Positions in two departments. A2 deliberately has NO candidates. */
const positions = [
  { _id: POS_A1, title: 'Dev backend', status: JobPositionStatus.Ouvert, department: DEPT_A },
  { _id: POS_A2, title: 'Poste vide', status: JobPositionStatus.Cloture, department: DEPT_A },
  { _id: POS_B1, title: 'Commercial', status: JobPositionStatus.Ouvert, department: DEPT_B },
];

/** currentStage + the decided delay in days, where accepted. */
const candidates = [
  { position: POS_A1, stage: CandidateStage.CandidatureRecue },
  { position: POS_A1, stage: CandidateStage.EntretienPlanifie },
  { position: POS_A1, stage: CandidateStage.Accepte, days: 10 },
  { position: POS_A1, stage: CandidateStage.Accepte, days: 20 },
  { position: POS_A1, stage: CandidateStage.Rejete },
  { position: POS_B1, stage: CandidateStage.Accepte, days: 60 },
  { position: POS_B1, stage: CandidateStage.CandidatureRecue },
];

const positionsFor = (filter: Record<string, unknown>) =>
  positions
    .filter((p) => !filter.department || String(p.department) === String(filter.department))
    .filter((p) => !filter._id || String(p._id) === String(filter._id));

const signInAs = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  mockedUser.findById.mockResolvedValue(who);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

const get = async (who: Record<string, unknown>, path: string) => {
  const cookie = await signInAs(who);
  return request(app).get(path).set('Cookie', cookie);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  mockedJobPosition.find.mockImplementation((filter?: Record<string, unknown>) => {
    const rows = positionsFor(filter ?? {});
    const chain = {
      sort: jest.fn().mockResolvedValue(rows),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  });

  mockedCandidate.aggregate.mockImplementation(async (pipeline: Array<Record<string, unknown>>) => {
    const match = (pipeline[0].$match ?? {}) as Record<string, unknown>;
    const posFilter = match.jobPositionId as { $in?: string[] } | undefined;
    const inScope = candidates.filter(
      (c) => !posFilter?.$in || posFilter.$in.map(String).includes(c.position),
    );

    // The pipeline report groups by (position, stage).
    const group = pipeline[1].$group as Record<string, unknown>;
    if ((group._id as Record<string, unknown>)?.position) {
      const counts = new Map<string, number>();
      for (const c of inScope) {
        const key = `${c.position}|${c.stage}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => {
        const [position, stage] = key.split('|');
        return { _id: { position, stage }, count };
      });
    }

    // The time-to-hire report groups everything into one bucket.
    const accepted = inScope.filter(
      (c) => c.stage === CandidateStage.Accepte && typeof c.days === 'number',
    );
    if (accepted.length === 0) {
      return [];
    }
    const msList = accepted.map((c) => c.days! * 24 * 3600 * 1000);
    return [
      {
        hires: accepted.length,
        avgMs: msList.reduce((a, b) => a + b, 0) / msList.length,
        minMs: Math.min(...msList),
        maxMs: Math.max(...msList),
      },
    ];
  });
});

afterAll(async () => {
  await closeSessionStore();
});

describe('Pipeline report — SRS §1.5, user story 22', () => {
  it('returns one row per position, with counts per stage', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const a1 = res.body.find((r: { jobPosition: { id: string } }) => r.jobPosition.id === POS_A1);
    expect(a1.stages[CandidateStage.CandidatureRecue]).toBe(1);
    expect(a1.stages[CandidateStage.Accepte]).toBe(2);
    expect(a1.total).toBe(5);
  });

  it('every row carries ALL SEVEN stages, zeroes included', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline');

    for (const row of res.body) {
      for (const stage of Object.values(CandidateStage)) {
        expect(typeof row.stages[stage]).toBe('number');
      }
    }
  });

  it('a position with NO candidates is included at zero, not dropped', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline');

    const empty = res.body.find(
      (r: { jobPosition: { id: string } }) => r.jobPosition.id === POS_A2,
    );
    // "Nobody has applied" is a result; dropping the row would make an empty
    // position indistinguishable from one that does not exist.
    expect(empty).toBeDefined();
    expect(empty.total).toBe(0);
  });

  it('a row carries the position status — a zero on a closed poste reads differently', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline');

    const empty = res.body.find(
      (r: { jobPosition: { id: string } }) => r.jobPosition.id === POS_A2,
    );
    expect(empty.jobPosition.status).toBe(JobPositionStatus.Cloture);
    expect(empty.jobPosition.title).toBe('Poste vide');
  });

  it('user story 22: jobPositionId narrows the report to one poste', async () => {
    const res = await get(marie, `/api/v1/reports/pipeline?jobPositionId=${POS_A1}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].jobPosition.id).toBe(POS_A1);
  });

  it('a malformed jobPositionId is a 400, not an empty report', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline?jobPositionId=not-an-id');

    expect(res.status).toBe(400);
    expect(mockedCandidate.aggregate).not.toHaveBeenCalled();
  });

  // ---- the two-principal comparison (D-047) ------------------------------

  it('rule 2: Pierre sees department A postes only', async () => {
    const res = await get(pierre, '/api/v1/reports/pipeline');

    const ids = res.body.map((r: { jobPosition: { id: string } }) => r.jobPosition.id);
    expect(ids).toEqual(expect.arrayContaining([POS_A1, POS_A2]));
    expect(ids).not.toContain(POS_B1);
  });

  it('rule 2: Sofia sees department B postes only', async () => {
    const res = await get(sofia, '/api/v1/reports/pipeline');

    const ids = res.body.map((r: { jobPosition: { id: string } }) => r.jobPosition.id);
    expect(ids).toEqual([POS_B1]);
    expect(ids).not.toContain(POS_A1);
  });

  it('rule 2: the two reports return DIFFERENT rows', async () => {
    const forPierre = await get(pierre, '/api/v1/reports/pipeline');
    const forSofia = await get(sofia, '/api/v1/reports/pipeline');

    expect(forPierre.body).toHaveLength(2);
    expect(forSofia.body).toHaveLength(1);
  });

  it('rule 2: a scoped caller naming a FOREIGN poste gets an empty report, not the data', async () => {
    const res = await get(pierre, `/api/v1/reports/pipeline?jobPositionId=${POS_B1}`);

    // The department clause NARROWS the filter rather than being replaced by
    // it — an empty result is the truthful answer (D-047's distinction).
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('the Recruteur is NOT department-scoped — both departments appear', async () => {
    const res = await get(marie, '/api/v1/reports/pipeline');

    const ids = res.body.map((r: { jobPosition: { id: string } }) => r.jobPosition.id);
    expect(ids).toEqual(expect.arrayContaining([POS_A1, POS_B1]));
  });
});

describe('Time-to-hire report — SRS §1.5, user story 23', () => {
  it('averages decidedAt - registeredAt over ACCEPTED candidates only', async () => {
    const res = await get(marie, '/api/v1/reports/time-to-hire');

    expect(res.status).toBe(200);
    // 10, 20 and 60 days across both departments.
    expect(res.body.hires).toBe(3);
    expect(res.body.averageDays).toBe(30);
  });

  it('returns the SAMPLE SIZE alongside the average', async () => {
    const res = await get(marie, '/api/v1/reports/time-to-hire');

    // An average over two hires is not a statistic, and a caller that cannot
    // see the sample size cannot tell.
    expect(res.body).toHaveProperty('hires');
    expect(typeof res.body.hires).toBe('number');
  });

  it('reports the fastest and slowest hire', async () => {
    const res = await get(marie, '/api/v1/reports/time-to-hire');

    expect(res.body.fastestDays).toBe(10);
    expect(res.body.slowestDays).toBe(60);
  });

  it('no hires gives null averages, NOT zero', async () => {
    mockedCandidate.aggregate.mockResolvedValue([]);

    const res = await get(marie, '/api/v1/reports/time-to-hire');

    // Zero days would be a false claim of instant hiring.
    expect(res.body.hires).toBe(0);
    expect(res.body.averageDays).toBeNull();
    expect(res.body.fastestDays).toBeNull();
    expect(res.body.slowestDays).toBeNull();
  });

  it('the period filters on decidedAt, not registeredAt', async () => {
    await get(marie, '/api/v1/reports/time-to-hire?fromDate=2026-01-01&toDate=2026-12-31');

    const match = mockedCandidate.aggregate.mock.calls[0][0][0].$match;
    // Filtering on registeredAt would exclude slow hires that had not yet
    // concluded and bias the average downward.
    expect(match.decidedAt).toBeDefined();
    expect(match.registeredAt).toBeUndefined();
  });

  it('only « Accepté » counts — a rejection is not a hire', async () => {
    await get(marie, '/api/v1/reports/time-to-hire');

    const match = mockedCandidate.aggregate.mock.calls[0][0][0].$match;
    expect(match.currentStage).toBe(CandidateStage.Accepte);
  });

  it('D-058: candidates with no decidedAt are excluded from the sample', async () => {
    await get(marie, '/api/v1/reports/time-to-hire');

    const match = mockedCandidate.aggregate.mock.calls[0][0][0].$match;
    // Counting them as zero delay would corrupt the average.
    expect(match.decidedAt).toMatchObject({ $ne: null });
  });

  it('D-041: a date-only toDate covers the whole day', async () => {
    await get(marie, '/api/v1/reports/time-to-hire?toDate=2026-08-11');

    const match = mockedCandidate.aggregate.mock.calls[0][0][0].$match;
    const upper = match.decidedAt.$lte as Date;
    expect(upper.toISOString()).toBe('2026-08-11T23:59:59.999Z');
  });

  it('an inverted range is a 400, not a silently empty report', async () => {
    const res = await get(marie, '/api/v1/reports/time-to-hire?fromDate=2026-12-01&toDate=2026-01-01');

    expect(res.status).toBe(400);
    expect(mockedCandidate.aggregate).not.toHaveBeenCalled();
  });

  it('an unparseable date is a 400', async () => {
    const res = await get(marie, '/api/v1/reports/time-to-hire?fromDate=hier');

    expect(res.status).toBe(400);
    expect(mockedCandidate.aggregate).not.toHaveBeenCalled();
  });

  it('rule 2: Sofia’s average covers department B only', async () => {
    const res = await get(sofia, '/api/v1/reports/time-to-hire');

    // Only the 60-day hire on POS_B1.
    expect(res.body.hires).toBe(1);
    expect(res.body.averageDays).toBe(60);
  });

  it('rule 2: Pierre’s average covers department A only, and DIFFERS from Sofia’s', async () => {
    const forPierre = await get(pierre, '/api/v1/reports/time-to-hire');
    const forSofia = await get(sofia, '/api/v1/reports/time-to-hire');

    expect(forPierre.body.hires).toBe(2);
    expect(forPierre.body.averageDays).toBe(15);
    expect(forPierre.body.averageDays).not.toBe(forSofia.body.averageDays);
  });
});

describe('FR-5: report access', () => {
  it('anonymous access is refused', async () => {
    const pipelineRes = await request(app).get('/api/v1/reports/pipeline');
    const ttoRes = await request(app).get('/api/v1/reports/time-to-hire');

    expect(pipelineRes.status).toBe(401);
    expect(ttoRes.status).toBe(401);
  });

  it('workflow step 9: BOTH the Recruteur and the Responsable may report', async () => {
    const forMarie = await get(marie, '/api/v1/reports/pipeline');
    const forPierre = await get(pierre, '/api/v1/reports/pipeline');

    expect(forMarie.status).toBe(200);
    expect(forPierre.status).toBe(200);
  });

  it('D-068: the Administrateur may READ both reports, on D-038 oversight grounds', async () => {
    const pipelineRes = await get(admin, '/api/v1/reports/pipeline');
    const ttoRes = await get(admin, '/api/v1/reports/time-to-hire');

    expect(pipelineRes.status).toBe(200);
    expect(ttoRes.status).toBe(200);
  });

  it('D-068 / D-027: the Administrateur is NOT department-scoped — they see the whole organisation', async () => {
    const res = await get(admin, '/api/v1/reports/pipeline');

    expect(res.status).toBe(200);
    // A scoped caller would have had a department filter applied; the
    // Administrateur must not, or the oversight view would be partial and
    // silently so.
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('rule 2: a Responsable with no department is refused, not given everything', async () => {
    const orphan = { ...pierre, _id: new Types.ObjectId().toString(), departmentId: undefined };

    const res = await get(orphan, '/api/v1/reports/pipeline');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Interview } from '../src/models/Interview.model';
import { AuditLog } from '../src/models/AuditLog.model';
import {
  Role,
  CandidateStage,
  JobPositionStatus,
  InterviewStatus,
  AuditAction,
  AuditTargetType,
} from '../src/common/constants';
import { RECENT_LIMIT } from '../src/services/dashboard.service';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as {
  findOne: jest.Mock;
  findById: jest.Mock;
  countDocuments: jest.Mock;
};
const mockedCandidate = Candidate as unknown as {
  find: jest.Mock;
  aggregate: jest.Mock;
};
const mockedJobPosition = JobPosition as unknown as {
  find: jest.Mock;
  countDocuments: jest.Mock;
};
const mockedInterview = Interview as unknown as { find: jest.Mock; countDocuments: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { find: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);

const DEPT_A = new Types.ObjectId().toString();
const DEPT_B = new Types.ObjectId().toString();
const POS_A = new Types.ObjectId().toString();
const POS_B = new Types.ObjectId().toString();
const PIERRE_ID = new Types.ObjectId().toString();
const SOFIA_ID = new Types.ObjectId().toString();

const base = { name: 'X', passwordHash, isActive: true, mustChangePassword: false };
const marie = {
  ...base,
  _id: new Types.ObjectId().toString(),
  name: 'Marie',
  email: 'marie@example.com',
  role: Role.Recruteur,
  departmentId: DEPT_A,
};
/** Pierre owns department A, Sofia department B — the two principals. */
const pierre = {
  ...base,
  _id: PIERRE_ID,
  name: 'Pierre',
  email: 'pierre@example.com',
  role: Role.ResponsableHierarchique,
  departmentId: DEPT_A,
};
const sofia = {
  ...base,
  _id: SOFIA_ID,
  name: 'Sofia',
  email: 'sofia@example.com',
  role: Role.ResponsableHierarchique,
  departmentId: DEPT_B,
};
const admin = {
  ...base,
  _id: new Types.ObjectId().toString(),
  name: 'Admin',
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined,
};

/**
 * A small department-aware fake, so FR-46's scoping is asserted on the ROWS
 * that come back rather than on the query object.
 *
 * This is the FR-35 lesson from SESSION_NOTES applied deliberately: the
 * off-by-scope bug that shipped there passed its unit test precisely because
 * the test inspected the query. Here Pierre and Sofia hold genuinely different
 * data and each dashboard is checked for the other's absence.
 */
const positionsByDept: Record<string, string[]> = { [DEPT_A]: [POS_A], [DEPT_B]: [POS_B] };

const candidateRows = [
  { _id: 'c1', position: POS_A, stage: CandidateStage.CandidatureRecue, name: 'Alice A' },
  { _id: 'c2', position: POS_A, stage: CandidateStage.EntretienPlanifie, name: 'Bob A' },
  { _id: 'c3', position: POS_A, stage: CandidateStage.Accepte, name: 'Chloe A' },
  { _id: 'c4', position: POS_A, stage: CandidateStage.RejeteCv, name: 'Dan A' },
  { _id: 'c5', position: POS_B, stage: CandidateStage.CandidatureRecue, name: 'Emma B' },
  { _id: 'c6', position: POS_B, stage: CandidateStage.Rejete, name: 'Femi B' },
];

const interviewRows = [
  {
    _id: 'i1',
    interviewerId: PIERRE_ID,
    candidateId: 'c2',
    position: POS_A,
    status: InterviewStatus.Planifie,
    offsetMs: 3 * 24 * 3600 * 1000,
  },
  {
    _id: 'i2',
    interviewerId: PIERRE_ID,
    candidateId: 'c1',
    position: POS_A,
    status: InterviewStatus.Planifie,
    offsetMs: -3600 * 1000,
  },
  {
    _id: 'i3',
    interviewerId: SOFIA_ID,
    candidateId: 'c5',
    position: POS_B,
    status: InterviewStatus.Planifie,
    offsetMs: 2 * 24 * 3600 * 1000,
  },
  {
    _id: 'i4',
    interviewerId: PIERRE_ID,
    candidateId: 'c2',
    position: POS_A,
    status: InterviewStatus.Annule,
    offsetMs: 5 * 24 * 3600 * 1000,
  },
];

/** Resolve the position ids a `{ department }` / `{ $in }` filter selects. */
const positionsFor = (filter: Record<string, unknown>): string[] => {
  if (filter.department) {
    return positionsByDept[String(filter.department)] ?? [];
  }
  return [POS_A, POS_B];
};

const matchCandidates = (filter: Record<string, unknown>) => {
  const posFilter = filter.jobPositionId as { $in?: string[] } | undefined;
  return candidateRows.filter(
    (c) => !posFilter?.$in || posFilter.$in.map(String).includes(c.position),
  );
};

const matchInterviews = (filter: Record<string, unknown>) => {
  const candFilter = filter.candidateId as { $in?: string[] } | undefined;
  const when = filter.scheduledAt as { $gt?: Date; $lte?: Date } | undefined;
  return interviewRows.filter((i) => {
    if (String(i.interviewerId) !== String(filter.interviewerId)) return false;
    if (candFilter?.$in && !candFilter.$in.map(String).includes(i.candidateId)) return false;
    if (filter.status && i.status !== filter.status) return false;
    const at = new Date(Date.now() + i.offsetMs);
    if (when?.$gt && !(at > when.$gt)) return false;
    if (when?.$lte && !(at <= when.$lte)) return false;
    return true;
  });
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

const dashboardAs = async (who: Record<string, unknown>) => {
  const cookie = await signInAs(who);
  return request(app).get('/api/v1/dashboard').set('Cookie', cookie);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  mockedJobPosition.countDocuments.mockImplementation(async (filter: Record<string, unknown>) =>
    filter?.status === JobPositionStatus.Ouvert ? 3 : 0,
  );
  mockedJobPosition.find.mockImplementation(async (filter: Record<string, unknown>) =>
    positionsFor(filter ?? {}).map((id) => ({ _id: id })),
  );

  mockedCandidate.aggregate.mockImplementation(async (pipeline: Array<Record<string, unknown>>) => {
    const match = (pipeline[0].$match ?? {}) as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (const row of matchCandidates(match)) {
      counts[row.stage] = (counts[row.stage] ?? 0) + 1;
    }
    return Object.entries(counts).map(([stage, count]) => ({ _id: stage, count }));
  });

  // Candidate.find serves two callers: the department id lookup (awaited
  // directly) and the recruiter's recent list (a populate/sort/limit chain).
  mockedCandidate.find.mockImplementation((filter?: Record<string, unknown>) => {
    const rows = matchCandidates(filter ?? {}).map((c) => ({ _id: c._id }));
    const chain = {
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockImplementation(async (n: number) =>
            candidateRows.slice(0, n).map((c) => ({
              _id: c._id,
              fullName: c.name,
              currentStage: c.stage,
              registeredAt: new Date('2026-08-10T09:00:00.000Z'),
              jobPositionId: { _id: c.position, title: `Poste ${c.position}` },
            })),
          ),
        }),
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  });

  mockedInterview.find.mockImplementation((filter: Record<string, unknown>) => {
    const rows = matchInterviews(filter).map((i) => ({
      _id: i._id,
      scheduledAt: new Date(Date.now() + i.offsetMs),
      status: i.status,
      candidateId: {
        _id: i.candidateId,
        fullName: candidateRows.find((c) => c._id === i.candidateId)?.name,
        jobPositionId: { _id: i.position, title: `Poste ${i.position}` },
      },
      interviewerId: { _id: i.interviewerId, name: 'X' },
    }));
    return {
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    };
  });

  mockedInterview.countDocuments.mockImplementation(async (filter: Record<string, unknown>) =>
    matchInterviews(filter).length,
  );

  mockedUser.countDocuments.mockResolvedValue(7);

  mockedAuditLog.find.mockReturnValue({
    populate: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([
          {
            _id: 'a1',
            action: AuditAction.UtilisateurCree,
            targetType: AuditTargetType.User,
            targetId: 'u1',
            timestamp: new Date('2026-08-10T12:00:00.000Z'),
            userId: { _id: 'admin1', name: 'Admin' },
          },
        ]),
      }),
    }),
  });
});

afterAll(async () => {
  await closeSessionStore();
});

describe('FR-45: Recruteur dashboard', () => {
  it('FR-45: returns the open-position count, stage breakdown and recent candidates', async () => {
    const res = await dashboardAs(marie);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.Recruteur);
    expect(res.body.openPositions).toBe(3);
    expect(res.body.candidatesByStage).toBeDefined();
    expect(Array.isArray(res.body.recentCandidates)).toBe(true);
  });

  it('FR-45: "postes ouverts" counts Ouvert only, not Brouillon or Clôturé', async () => {
    await dashboardAs(marie);

    expect(mockedJobPosition.countDocuments).toHaveBeenCalledWith({
      status: JobPositionStatus.Ouvert,
    });
  });

  it('FR-45: the breakdown carries ALL SEVEN stages, including zeroes', async () => {
    const res = await dashboardAs(marie);

    for (const stage of Object.values(CandidateStage)) {
      expect(res.body.candidatesByStage).toHaveProperty(stage);
      expect(typeof res.body.candidatesByStage[stage]).toBe('number');
    }
    // A stage nobody is in must be present at 0, not absent.
    expect(res.body.candidatesByStage[CandidateStage.EvaluationCompletee]).toBe(0);
  });

  it('FR-45: the breakdown counts every candidate, across all departments', async () => {
    const res = await dashboardAs(marie);

    // D-027/FR-17: the Recruteur is not department-scoped.
    expect(res.body.candidatesByStage[CandidateStage.CandidatureRecue]).toBe(2);
    expect(res.body.candidatesByStage[CandidateStage.Accepte]).toBe(1);
    expect(res.body.candidatesByStage[CandidateStage.Rejete]).toBe(1);
  });

  it('FR-45: recent candidates are capped and carry the position title', async () => {
    const res = await dashboardAs(marie);

    expect(res.body.recentCandidates.length).toBeLessThanOrEqual(RECENT_LIMIT);
    expect(res.body.recentCandidates[0]).toHaveProperty('fullName');
    expect(res.body.recentCandidates[0].jobPosition).toHaveProperty('title');
  });

  it('FR-45: a dashboard row carries no email or phone', async () => {
    const res = await dashboardAs(marie);

    // Not asked for by FR-45; a summary screen is not a contact list.
    expect(res.body.recentCandidates[0]).not.toHaveProperty('email');
    expect(res.body.recentCandidates[0]).not.toHaveProperty('phone');
  });

  it('FR-45: the Recruteur gets no admin or responsable metrics', async () => {
    const res = await dashboardAs(marie);

    expect(res.body).not.toHaveProperty('activeUsers');
    expect(res.body).not.toHaveProperty('pendingEvaluations');
    expect(res.body).not.toHaveProperty('recentAuditEntries');
  });
});

describe('FR-46: Responsable hiérarchique dashboard — department-scoped', () => {
  it('FR-46: returns the four metrics FR-46 names', async () => {
    const res = await dashboardAs(pierre);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.ResponsableHierarchique);
    expect(typeof res.body.departmentCandidatesInProgress).toBe('number');
    expect(Array.isArray(res.body.upcomingInterviews)).toBe(true);
    expect(typeof res.body.pendingEvaluations).toBe('number');
  });

  it('FR-46: "en cours" excludes the three terminal stages', async () => {
    const res = await dashboardAs(pierre);

    // Department A holds 4 candidates: 1 reçue, 1 entretien planifié,
    // 1 Accepté, 1 Rejeté (CV). Only the first two are in progress.
    expect(res.body.departmentCandidatesInProgress).toBe(2);
  });

  // ---- the two-principal comparison D-047 requires -----------------------

  it('FR-46 / rule 2: Pierre sees department A only — NOT Sofia’s candidates', async () => {
    const res = await dashboardAs(pierre);

    expect(res.body.candidatesByStage[CandidateStage.CandidatureRecue]).toBe(1);
    // Emma B is « Candidature reçue » too but lives in department B.
    expect(res.body.candidatesByStage[CandidateStage.Rejete]).toBe(0);
  });

  it('FR-46 / rule 2: Sofia sees department B only — NOT Pierre’s candidates', async () => {
    const res = await dashboardAs(sofia);

    expect(res.body.candidatesByStage[CandidateStage.CandidatureRecue]).toBe(1);
    expect(res.body.candidatesByStage[CandidateStage.Rejete]).toBe(1);
    // Pierre's Accepté candidate is in department A and must not appear.
    expect(res.body.candidatesByStage[CandidateStage.Accepte]).toBe(0);
    expect(res.body.departmentCandidatesInProgress).toBe(1);
  });

  it('FR-46 / rule 2: the two dashboards return DIFFERENT numbers', async () => {
    // The comparison itself, not just each side in isolation — a scope clause
    // that was dropped entirely would make both sides equal and both of the
    // tests above would have to be wrong in the same direction to hide it.
    const forPierre = await dashboardAs(pierre);
    const forSofia = await dashboardAs(sofia);

    expect(forPierre.body.departmentCandidatesInProgress).not.toBe(
      forSofia.body.departmentCandidatesInProgress,
    );
  });

  it('FR-46: upcoming interviews are Pierre’s OWN, and exclude Sofia’s rows', async () => {
    const res = await dashboardAs(pierre);

    const ids = res.body.upcomingInterviews.map((i: { id: string }) => i.id);
    expect(ids).toContain('i1');
    expect(ids).not.toContain('i3');
  });

  it('FR-46: Sofia’s upcoming interviews are hers, and exclude Pierre’s', async () => {
    const res = await dashboardAs(sofia);

    const ids = res.body.upcomingInterviews.map((i: { id: string }) => i.id);
    expect(ids).toEqual(['i3']);
  });

  it('FR-46: "à venir" excludes past slots and cancelled interviews', async () => {
    const res = await dashboardAs(pierre);

    const ids = res.body.upcomingInterviews.map((i: { id: string }) => i.id);
    // i2 is in the past (it is a pending EVALUATION, not an upcoming slot).
    expect(ids).not.toContain('i2');
    // i4 is cancelled.
    expect(ids).not.toContain('i4');
  });

  it('FR-46 / D-048: pending evaluations are past-dated Planifié interviews', async () => {
    const res = await dashboardAs(pierre);

    // Exactly i2 — the same gate D-048 uses to accept an evaluation.
    expect(res.body.pendingEvaluations).toBe(1);
  });

  it('FR-46: Sofia has no pending evaluations — hers is in the future', async () => {
    const res = await dashboardAs(sofia);

    expect(res.body.pendingEvaluations).toBe(0);
  });

  it('FR-46: an upcoming interview row carries the candidate and the poste', async () => {
    const res = await dashboardAs(pierre);

    const row = res.body.upcomingInterviews[0];
    expect(row.candidate).toHaveProperty('fullName');
    expect(row.jobPosition).toHaveProperty('title');
  });

  it('rule 2: a Responsable with no department is refused, not given everything', async () => {
    const orphan = { ...pierre, _id: new Types.ObjectId().toString(), departmentId: undefined };

    const res = await dashboardAs(orphan);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('FR-46: the Responsable gets no recruiter or admin metrics', async () => {
    const res = await dashboardAs(pierre);

    expect(res.body).not.toHaveProperty('openPositions');
    expect(res.body).not.toHaveProperty('recentCandidates');
    expect(res.body).not.toHaveProperty('activeUsers');
  });
});

describe('FR-47: Administrateur dashboard', () => {
  it('FR-47: returns the active-user count and recent audit entries', async () => {
    const res = await dashboardAs(admin);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.Administrateur);
    expect(res.body.activeUsers).toBe(7);
    expect(res.body.recentAuditEntries).toHaveLength(1);
  });

  it('FR-47: "utilisateurs actifs" counts isActive only', async () => {
    await dashboardAs(admin);

    expect(mockedUser.countDocuments).toHaveBeenCalledWith({ isActive: true });
  });

  it('FR-47: an audit row names the ACTOR, not a bare ObjectId', async () => {
    const res = await dashboardAs(admin);

    const entry = res.body.recentAuditEntries[0];
    expect(entry.user).toEqual({ id: 'admin1', name: 'Admin' });
    expect(entry.action).toBe(AuditAction.UtilisateurCree);
    expect(entry.targetType).toBe(AuditTargetType.User);
    expect(entry.timestamp).toBe('2026-08-10T12:00:00.000Z');
  });

  it('FR-47: the admin gets no recruiter or responsable metrics', async () => {
    const res = await dashboardAs(admin);

    expect(res.body).not.toHaveProperty('openPositions');
    expect(res.body).not.toHaveProperty('pendingEvaluations');
  });

  it('D-033: an audit row carries no payload', async () => {
    const res = await dashboardAs(admin);

    const entry = res.body.recentAuditEntries[0];
    expect(Object.keys(entry).sort()).toEqual(
      ['action', 'id', 'targetId', 'targetType', 'timestamp', 'user'].sort(),
    );
  });
});

describe('FR-5 / UC-14: access', () => {
  it('FR-5: anonymous access is refused', async () => {
    const res = await request(app).get('/api/v1/dashboard');

    expect(res.status).toBe(401);
  });

  it('UC-14: all three roles reach the route — the role selects the SHAPE', async () => {
    const forMarie = await dashboardAs(marie);
    const forPierre = await dashboardAs(pierre);
    const forAdmin = await dashboardAs(admin);

    expect([forMarie.status, forPierre.status, forAdmin.status]).toEqual([200, 200, 200]);
    expect([forMarie.body.role, forPierre.body.role, forAdmin.body.role]).toEqual([
      Role.Recruteur,
      Role.ResponsableHierarchique,
      Role.Administrateur,
    ]);
  });

  it('NFR-04: the role comes from the session — a query parameter cannot change it', async () => {
    const cookie = await signInAs(marie);

    const res = await request(app)
      .get(`/api/v1/dashboard?role=${Role.Administrateur}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.Recruteur);
    expect(res.body).not.toHaveProperty('activeUsers');
  });
});

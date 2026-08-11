import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Role, AuditAction, AuditTargetType } from '../src/common/constants';
import { AUDIT_LOG_LIMIT } from '../src/services/auditLog.service';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedAuditLog = AuditLog as unknown as {
  find: jest.Mock;
  countDocuments: jest.Mock;
  create: jest.Mock;
};

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);

const base = { name: 'X', passwordHash, isActive: true, mustChangePassword: false };
const admin = { ...base, _id: new Types.ObjectId().toString(), name: 'Admin', email: 'admin@example.com', role: Role.Administrateur };
const marie = { ...base, _id: new Types.ObjectId().toString(), email: 'marie@example.com', role: Role.Recruteur, departmentId: new Types.ObjectId().toString() };
const pierre = { ...base, _id: new Types.ObjectId().toString(), email: 'pierre@example.com', role: Role.ResponsableHierarchique, departmentId: new Types.ObjectId().toString() };

const ACTOR_ID = new Types.ObjectId().toString();

const entries = [
  {
    _id: 'e1',
    action: AuditAction.UtilisateurCree,
    targetType: AuditTargetType.User,
    targetId: 'u1',
    timestamp: new Date('2026-08-11T12:00:00.000Z'),
  },
  {
    _id: 'e2',
    action: AuditAction.PosteCloture,
    targetType: AuditTargetType.JobPosition,
    targetId: 'p1',
    timestamp: new Date('2026-08-10T12:00:00.000Z'),
  },
  {
    _id: 'e3',
    action: AuditAction.EtapeCandidatModifiee,
    targetType: AuditTargetType.Candidate,
    targetId: 'c1',
    timestamp: new Date('2026-08-09T12:00:00.000Z'),
  },
];

let lastSort: Record<string, number> | undefined;
let lastLimit: number | undefined;

const matching = (query: Record<string, unknown>) =>
  entries
    .filter((e) => !query.action || e.action === query.action)
    .filter((e) => !query.targetType || e.targetType === query.targetType)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

const signInAs = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  mockedUser.findById.mockResolvedValue(who);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

const get = async (who: Record<string, unknown>, path = '/api/v1/audit-logs') => {
  const cookie = await signInAs(who);
  return request(app).get(path).set('Cookie', cookie);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();
  lastSort = undefined;
  lastLimit = undefined;

  mockedAuditLog.find.mockImplementation((query: Record<string, unknown>) => {
    const rows = matching(query ?? {}).map((e) => ({
      ...e,
      userId: { _id: ACTOR_ID, name: 'Admin' },
    }));
    return {
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockImplementation((s: Record<string, number>) => {
          lastSort = s;
          return {
            limit: jest.fn().mockImplementation(async (n: number) => {
              lastLimit = n;
              return rows.slice(0, n);
            }),
          };
        }),
      }),
    };
  });

  mockedAuditLog.countDocuments.mockImplementation(async (query: Record<string, unknown>) =>
    matching(query ?? {}).length,
  );
});

afterAll(async () => {
  await closeSessionStore();
});

describe('UC-04: GET /audit-logs', () => {
  it('UC-04: returns the audit entries', async () => {
    const res = await get(admin);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it('UC-04: newest first', async () => {
    const res = await get(admin);

    expect(res.body.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(lastSort).toEqual({ timestamp: -1 });
  });

  it('UC-04: capped at 50 entries', async () => {
    await get(admin);

    expect(lastLimit).toBe(AUDIT_LOG_LIMIT);
    expect(AUDIT_LOG_LIMIT).toBe(50);
  });

  it('X-Total-Count reports the pre-cap total, so 50 rows are not mistaken for all of them', async () => {
    const res = await get(admin);

    expect(res.headers['x-total-count']).toBe('3');
    expect(res.headers['x-page-limit']).toBe('50');
  });

  it('an entry names the ACTOR, not a bare ObjectId (NFR-09)', async () => {
    const res = await get(admin);

    expect(res.body[0].user).toEqual({ id: ACTOR_ID, name: 'Admin' });
  });

  it('D-033: an entry carries who/what/when and NO payload', async () => {
    const res = await get(admin);

    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['action', 'id', 'targetId', 'targetType', 'timestamp', 'user'].sort(),
    );
  });

  it('UC-04: filters by action', async () => {
    const res = await get(admin, `/api/v1/audit-logs?action=${AuditAction.PosteCloture}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe(AuditAction.PosteCloture);
    expect(res.headers['x-total-count']).toBe('1');
  });

  it('UC-04: filters by targetType', async () => {
    const res = await get(admin, `/api/v1/audit-logs?targetType=${AuditTargetType.Candidate}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].targetType).toBe(AuditTargetType.Candidate);
  });

  it('UC-04: both filters combine', async () => {
    const res = await get(
      admin,
      `/api/v1/audit-logs?action=${AuditAction.UtilisateurCree}&targetType=${AuditTargetType.User}`,
    );

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('e1');
  });

  it('an unknown action is a 400, NOT a falsely empty journal', async () => {
    const res = await get(admin, '/api/v1/audit-logs?action=RienDuTout');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedAuditLog.find).not.toHaveBeenCalled();
  });

  it('an unknown targetType is a 400 too', async () => {
    const res = await get(admin, '/api/v1/audit-logs?targetType=Chose');

    expect(res.status).toBe(400);
    expect(mockedAuditLog.find).not.toHaveBeenCalled();
  });

  it('a filter matching nothing is an empty array, not an error', async () => {
    const res = await get(admin, `/api/v1/audit-logs?action=${AuditAction.MotDePasseReinitialise}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['x-total-count']).toBe('0');
  });

  it('reading the journal is NOT itself audited', async () => {
    await get(admin);

    // rule 4 covers state changes; auditing reads would bury the signal.
    expect(mockedAuditLog.find).toHaveBeenCalled();
    expect(mockedAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('FR-5 / Section 9: audit log access is Administrateur only', () => {
  it('anonymous access is refused', async () => {
    const res = await request(app).get('/api/v1/audit-logs');

    expect(res.status).toBe(401);
    expect(mockedAuditLog.find).not.toHaveBeenCalled();
  });

  it('a Recruteur is 403', async () => {
    const res = await get(marie);

    expect(res.status).toBe(403);
    expect(mockedAuditLog.find).not.toHaveBeenCalled();
  });

  it('a Responsable hiérarchique is 403', async () => {
    const res = await get(pierre);

    expect(res.status).toBe(403);
    expect(mockedAuditLog.find).not.toHaveBeenCalled();
  });
});

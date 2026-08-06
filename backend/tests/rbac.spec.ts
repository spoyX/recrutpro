import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { User } from '../src/models/User.model';
import { Role } from '../src/common/constants';
import { sessionMiddleware, closeSessionStore } from '../src/config/session';
import { requireAuth, requireRole, assertDepartmentAccess } from '../src/middleware/rbac.middleware';
import { errorHandler } from '../src/middleware/error.middleware';
import { establishSession } from '../src/services/auth.service';

jest.mock('../src/models/User.model');

const mockedFindById = User.findById as unknown as jest.Mock;

const DEPT_A = new Types.ObjectId().toString();
const DEPT_B = new Types.ObjectId().toString();

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId().toString(),
  name: 'Test User',
  email: 'test@example.com',
  role: Role.Recruteur,
  departmentId: DEPT_A,
  isActive: true,
  mustChangePassword: false,
  ...overrides,
});

/**
 * Harness mounting the REAL session middleware and the REAL RBAC middleware
 * around throwaway routes. There are no protected business routes yet (they
 * arrive with the User Management module), so the routes exist only here —
 * nothing is added to src/ that would have to be removed later.
 */
const buildHarness = () => {
  const harness = express();
  harness.use(express.json());
  harness.use(sessionMiddleware);

  // Stands in for POST /auth/login: establishes a real session.
  harness.post('/_signin', async (req, res, next) => {
    try {
      await establishSession(req, req.body.user);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  harness.get('/_any-authenticated', requireAuth, (req, res) => {
    res.json({ id: String(req.currentUser?._id) });
  });

  harness.get('/_admin-only', requireAuth, requireRole(Role.Administrateur), (_req, res) => {
    res.json({ ok: true });
  });

  harness.get(
    '/_manager-only',
    requireAuth,
    requireRole(Role.ResponsableHierarchique),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  // Rule 2: the resource's department comes from the loaded record, never from
  // the client. :dept stands in for "the department the resource turned out to
  // belong to" once fetched by id.
  harness.get('/_scoped/:dept', requireAuth, (req, res, next) => {
    try {
      // Express 5 types a route param as string | string[].
      assertDepartmentAccess(req.currentUser!, String(req.params.dept));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  harness.use(errorHandler);
  return harness;
};

const app = buildHarness();

/** Signs in as `user` and returns the session cookie. */
const signInAs = async (user: Record<string, unknown>): Promise<string[]> => {
  const res = await request(app).post('/_signin').send({ user });
  return res.headers['set-cookie'] as unknown as string[];
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeSessionStore();
});

describe('RBAC middleware — FR-5', () => {
  it('FR-5: an unauthenticated request is rejected with 401', async () => {
    const res = await request(app).get('/_any-authenticated');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Vous devez être connecté pour accéder à cette ressource.',
      },
    });
    expect(mockedFindById).not.toHaveBeenCalled();
  });

  it('FR-5: an authenticated request with the correct role passes through', async () => {
    const admin = makeUser({ role: Role.Administrateur, departmentId: undefined });
    mockedFindById.mockResolvedValue(admin);

    const cookie = await signInAs(admin);
    const res = await request(app).get('/_admin-only').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('FR-5: an authenticated request with the WRONG role is rejected with 403', async () => {
    const recruteur = makeUser({ role: Role.Recruteur });
    mockedFindById.mockResolvedValue(recruteur);

    const cookie = await signInAs(recruteur);
    const res = await request(app).get('/_admin-only').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('FR-5 / FR-8: a session whose account was deactivated mid-session is rejected', async () => {
    const user = makeUser();
    mockedFindById.mockResolvedValue(user);
    const cookie = await signInAs(user);

    // Account deactivated after the session was established.
    mockedFindById.mockResolvedValue({ ...user, isActive: false });
    const res = await request(app).get('/_any-authenticated').set('Cookie', cookie);

    expect(res.status).toBe(401);
  });

  it('FR-5: a session pointing at a deleted user is rejected', async () => {
    const user = makeUser();
    mockedFindById.mockResolvedValue(user);
    const cookie = await signInAs(user);

    mockedFindById.mockResolvedValue(null);
    const res = await request(app).get('/_any-authenticated').set('Cookie', cookie);

    expect(res.status).toBe(401);
  });

  it('FR-5: the role is read from the DATABASE, not from the session', async () => {
    // Signed in as a Recruteur...
    const user = makeUser({ role: Role.Recruteur });
    mockedFindById.mockResolvedValue(user);
    const cookie = await signInAs(user);

    // ...then promoted to Administrateur by an admin (FR-7). The change must
    // take effect on the next request, without re-login.
    mockedFindById.mockResolvedValue({ ...user, role: Role.Administrateur });
    const res = await request(app).get('/_admin-only').set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  describe('rule 2 — department scoping', () => {
    it('rule 2: a Responsable hiérarchique reaching OUTSIDE their department is rejected', async () => {
      const manager = makeUser({ role: Role.ResponsableHierarchique, departmentId: DEPT_A });
      mockedFindById.mockResolvedValue(manager);
      const cookie = await signInAs(manager);

      const res = await request(app).get(`/_scoped/${DEPT_B}`).set('Cookie', cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rule 2: a Responsable hiérarchique reaching INSIDE their department passes', async () => {
      const manager = makeUser({ role: Role.ResponsableHierarchique, departmentId: DEPT_A });
      mockedFindById.mockResolvedValue(manager);
      const cookie = await signInAs(manager);

      const res = await request(app).get(`/_scoped/${DEPT_A}`).set('Cookie', cookie);

      expect(res.status).toBe(200);
    });

    it('rule 2: an Administrateur is not department-scoped', async () => {
      const admin = makeUser({ role: Role.Administrateur, departmentId: undefined });
      mockedFindById.mockResolvedValue(admin);
      const cookie = await signInAs(admin);

      const res = await request(app).get(`/_scoped/${DEPT_B}`).set('Cookie', cookie);

      expect(res.status).toBe(200);
    });

    it('rule 2: a Recruteur is not department-scoped (FR-17, FR-45)', async () => {
      const recruteur = makeUser({ role: Role.Recruteur, departmentId: DEPT_A });
      mockedFindById.mockResolvedValue(recruteur);
      const cookie = await signInAs(recruteur);

      const res = await request(app).get(`/_scoped/${DEPT_B}`).set('Cookie', cookie);

      expect(res.status).toBe(200);
    });

    it('rule 2: a manager with no department is rejected, never waved through', async () => {
      const manager = makeUser({ role: Role.ResponsableHierarchique, departmentId: undefined });
      mockedFindById.mockResolvedValue(manager);
      const cookie = await signInAs(manager);

      const res = await request(app).get(`/_scoped/${DEPT_A}`).set('Cookie', cookie);

      expect(res.status).toBe(403);
    });
  });

  it('FR-5: requireRole without requireAuth fails CLOSED', async () => {
    const misconfigured = express();
    misconfigured.use(express.json());
    misconfigured.use(sessionMiddleware);
    // requireAuth deliberately omitted — a wiring mistake must not open the route.
    misconfigured.get('/_oops', requireRole(Role.Administrateur), (_req, res) => {
      res.json({ ok: true });
    });
    misconfigured.use(errorHandler);

    const res = await request(misconfigured).get('/_oops');

    expect(res.status).toBe(401);
  });
});

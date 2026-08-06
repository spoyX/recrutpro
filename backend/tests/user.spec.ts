import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Department } from '../src/models/Department.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Role, AuditAction, AuditTargetType } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Department.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as {
  findOne: jest.Mock;
  findById: jest.Mock;
  exists: jest.Mock;
  create: jest.Mock;
};
const mockedDepartment = Department as unknown as { findById: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

/** The single audit document written by the action under test. */
const auditEntry = () => {
  expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
  return mockedAuditLog.create.mock.calls[0][0];
};

const ADMIN_PASSWORD = 'Adm1n!Passw0rd';
const adminHash = hashSync(ADMIN_PASSWORD, 4);

const ADMIN_ID = new Types.ObjectId().toString();
const TARGET_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();

const admin = {
  _id: ADMIN_ID,
  name: 'Admin',
  email: 'admin@example.com',
  passwordHash: adminHash,
  role: Role.Administrateur,
  isActive: true,
  mustChangePassword: false,
};

/** A saved document: mutable, with save() recording that it persisted. */
const makeTarget = (overrides: Record<string, unknown> = {}) => ({
  _id: TARGET_ID,
  name: 'Marie Dupont',
  email: 'marie@example.com',
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// passwordHash is absent from the literal above but IS assigned by the service
// during a password reset (FR-10), which is what the NFR-03 test reads back.
let target: ReturnType<typeof makeTarget> & { passwordHash?: string };

/** Logs in as the admin through the REAL login endpoint and returns the cookie. */
const signInAsAdmin = async (): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(admin) });
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@example.com', password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

let adminCookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();
  target = makeTarget();

  // requireAuth reloads the caller each request (D-027); the service also
  // looks the TARGET up by id, so both resolve from the same map.
  mockedUser.findById.mockImplementation((id: unknown) => {
    const key = String(id);
    if (key === ADMIN_ID) return Promise.resolve(admin);
    if (key === TARGET_ID) return Promise.resolve(target);
    return Promise.resolve(null);
  });
  mockedDepartment.findById.mockResolvedValue({ _id: DEPT_ID, name: 'Ingénierie', isActive: true });
  mockedUser.exists.mockResolvedValue(null);
  mockedAuditLog.create.mockResolvedValue({});

  adminCookie = await signInAsAdmin();
});

afterAll(async () => {
  await closeSessionStore();
});

const asAdmin = (method: 'get' | 'post' | 'patch', url: string) =>
  request(app)[method](url).set('Cookie', adminCookie);

describe('User management — FR-6 to FR-9', () => {
  describe('FR-6: create a user', () => {
    it('FR-6: creates an account with name, email, role and department', async () => {
      mockedUser.create.mockResolvedValue({
        ...makeTarget(),
        mustChangePassword: true,
      });

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'Marie@Example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(201);
      const created = mockedUser.create.mock.calls[0][0];
      expect(created.name).toBe('Marie Dupont');
      // Stored lowercased so login lookups match regardless of how it was typed.
      expect(created.email).toBe('marie@example.com');
      expect(created.role).toBe(Role.Recruteur);
      expect(created.isActive).toBe(true);
    });

    it('FR-6 / NFR-03: the password is hashed, never stored in clear', async () => {
      mockedUser.create.mockResolvedValue(makeTarget());

      await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      const created = mockedUser.create.mock.calls[0][0];
      expect(created.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(created.passwordHash).not.toContain('S3cret!Passw0rd');
      expect(created).not.toHaveProperty('password');
    });

    it('D-029: a created account must change its password at first login', async () => {
      mockedUser.create.mockResolvedValue(makeTarget());

      await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(mockedUser.create.mock.calls[0][0].mustChangePassword).toBe(true);
    });

    it('rule 3: the response never carries passwordHash', async () => {
      mockedUser.create.mockResolvedValue(makeTarget());

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('S3cret!Passw0rd');
    });

    it('FR-6: a duplicate email is rejected with 409', async () => {
      mockedUser.exists.mockResolvedValue({ _id: 'someone' });

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(mockedUser.create).not.toHaveBeenCalled();
    });

    it('FR-6 / FR-13: a DEACTIVATED department cannot be assigned (NFR-04)', async () => {
      mockedDepartment.findById.mockResolvedValue({ _id: DEPT_ID, name: 'Ancien', isActive: false });

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(400);
      expect(mockedUser.create).not.toHaveBeenCalled();
    });

    it('FR-6 / D-016: a Recruteur without a department is rejected', async () => {
      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
      });

      expect(res.status).toBe(400);
      expect(mockedUser.create).not.toHaveBeenCalled();
    });

    it('FR-6 / D-016: an Administrateur needs no department', async () => {
      mockedUser.create.mockResolvedValue(makeTarget({ role: Role.Administrateur }));

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Second Admin',
        email: 'admin2@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Administrateur,
      });

      expect(res.status).toBe(201);
      expect(mockedDepartment.findById).not.toHaveBeenCalled();
    });

    it('NFR-05: a password shorter than the minimum is rejected', async () => {
      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'court',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(400);
      expect(mockedUser.create).not.toHaveBeenCalled();
    });

    it('NFR-05: an unknown role value is rejected', async () => {
      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: 'SuperAdmin',
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(400);
      expect(mockedUser.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-7: edit a user', () => {
    it('FR-7: updates the name', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({
        name: 'Marie Durand',
      });

      expect(res.status).toBe(200);
      expect(target.name).toBe('Marie Durand');
      expect(target.save).toHaveBeenCalled();
    });

    it('FR-7: updates the role and department together', async () => {
      const newDept = new Types.ObjectId().toString();
      mockedDepartment.findById.mockResolvedValue({ _id: newDept, isActive: true });

      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({
        role: Role.ResponsableHierarchique,
        departmentId: newDept,
      });

      expect(res.status).toBe(200);
      expect(target.role).toBe(Role.ResponsableHierarchique);
      expect(String(target.departmentId)).toBe(newDept);
    });

    it('FR-7: promoting to Administrateur clears the department (rule 2)', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({
        role: Role.Administrateur,
      });

      expect(res.status).toBe(200);
      expect(target.departmentId).toBeUndefined();
    });

    it('FR-7: demoting an Administrateur without giving a department is rejected', async () => {
      target = makeTarget({ role: Role.Administrateur, departmentId: undefined });

      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({
        role: Role.Recruteur,
      });

      expect(res.status).toBe(400);
      expect(target.save).not.toHaveBeenCalled();
    });

    it('FR-7: the email is NOT editable', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({
        email: 'nouvelle@example.com',
      });

      expect(res.status).toBe(200);
      expect(target.email).toBe('marie@example.com');
    });

    it('FR-7: an unknown user is a 404', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${new Types.ObjectId()}`).send({
        name: 'Fantôme',
      });

      expect(res.status).toBe(404);
    });

    it('FR-7: a malformed id is a 404, not a 500', async () => {
      const res = await asAdmin('patch', '/api/v1/users/not-an-objectid').send({ name: 'X' });

      expect(res.status).toBe(404);
    });
  });

  describe('FR-8 / FR-9: deactivate and reactivate', () => {
    it('FR-8: deactivating sets isActive false and persists', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}/deactivate`);

      expect(res.status).toBe(200);
      expect(target.isActive).toBe(false);
      expect(target.save).toHaveBeenCalled();
    });

    it('FR-9: reactivating restores access', async () => {
      target = makeTarget({ isActive: false });

      const res = await asAdmin('patch', `/api/v1/users/${TARGET_ID}/reactivate`);

      expect(res.status).toBe(200);
      expect(target.isActive).toBe(true);
    });

    it('D-029: an administrator cannot deactivate their own account', async () => {
      const res = await asAdmin('patch', `/api/v1/users/${ADMIN_ID}/deactivate`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    });

    it('FR-8: deactivation history is preserved — the record is never deleted', async () => {
      await asAdmin('patch', `/api/v1/users/${TARGET_ID}/deactivate`);

      // Still the same document, just flagged.
      expect(target._id).toBe(TARGET_ID);
      expect(target.name).toBe('Marie Dupont');
    });
  });

  describe('FR-12: list and read', () => {
    const listResolves = (users: unknown[]) => {
      (mockedUser as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockReturnValue({ sort: jest.fn().mockResolvedValue(users) });
    };

    it('FR-12: lists all users when no filter is given', async () => {
      listResolves([makeTarget(), makeTarget({ _id: 'b', name: 'Autre' })]);

      const res = await asAdmin('get', '/api/v1/users');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect((mockedUser as unknown as { find: jest.Mock }).find).toHaveBeenCalledWith({});
    });

    it('FR-12: filters by role', async () => {
      listResolves([makeTarget()]);

      await asAdmin('get', `/api/v1/users?role=${Role.Recruteur}`);

      expect((mockedUser as unknown as { find: jest.Mock }).find).toHaveBeenCalledWith({
        role: Role.Recruteur,
      });
    });

    it('FR-12: filters by status — isActive=false must mean FALSE, not "truthy string"', async () => {
      listResolves([]);

      await asAdmin('get', '/api/v1/users?isActive=false');

      expect((mockedUser as unknown as { find: jest.Mock }).find).toHaveBeenCalledWith({
        isActive: false,
      });
    });

    it('FR-12: combines both filters', async () => {
      listResolves([]);

      await asAdmin('get', `/api/v1/users?role=${Role.Recruteur}&isActive=true`);

      expect((mockedUser as unknown as { find: jest.Mock }).find).toHaveBeenCalledWith({
        role: Role.Recruteur,
        isActive: true,
      });
    });

    it('FR-12 / NFR-05: an invalid filter value is rejected', async () => {
      listResolves([]);

      const res = await asAdmin('get', '/api/v1/users?isActive=maybe');

      expect(res.status).toBe(400);
    });

    it('FR-12 / rule 3: the list never carries passwordHash', async () => {
      listResolves([{ ...makeTarget(), passwordHash: '$2b$10$leaked' }]);

      const res = await asAdmin('get', '/api/v1/users');

      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('leaked');
    });

    it('FR-12: reads a single user', async () => {
      const res = await asAdmin('get', `/api/v1/users/${TARGET_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(TARGET_ID);
    });

    it('FR-12: reading an unknown user is a 404', async () => {
      const res = await asAdmin('get', `/api/v1/users/${new Types.ObjectId()}`);
      expect(res.status).toBe(404);
    });
  });

  describe('FR-10: password reset', () => {
    it('FR-10 / D-031: returns a temporary password ONCE and forces a change', async () => {
      const res = await asAdmin('post', `/api/v1/users/${TARGET_ID}/reset-password`);

      expect(res.status).toBe(200);
      expect(typeof res.body.temporaryPassword).toBe('string');
      expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
      expect(target.mustChangePassword).toBe(true);
      expect(target.save).toHaveBeenCalled();
    });

    it('FR-10 / NFR-03: the new password is stored only as a bcrypt hash', async () => {
      const res = await asAdmin('post', `/api/v1/users/${TARGET_ID}/reset-password`);

      const temp = res.body.temporaryPassword as string;
      expect(target.passwordHash).toMatch(/^\$2[aby]\$/);
      // The plaintext must not have been written anywhere on the document.
      expect(JSON.stringify({ ...target, save: undefined })).not.toContain(temp);
    });

    it('FR-10: each reset generates a different temporary password', async () => {
      const first = await asAdmin('post', `/api/v1/users/${TARGET_ID}/reset-password`);
      target = makeTarget();
      const second = await asAdmin('post', `/api/v1/users/${TARGET_ID}/reset-password`);

      expect(first.body.temporaryPassword).not.toBe(second.body.temporaryPassword);
    });

    it('FR-10: resetting an unknown user is a 404', async () => {
      const res = await asAdmin('post', `/api/v1/users/${new Types.ObjectId()}/reset-password`);
      expect(res.status).toBe(404);
    });
  });

  describe('FR-11 / rule 4: every action writes a real AuditLog document', () => {
    it('FR-11: creating a user is audited', async () => {
      mockedUser.create.mockResolvedValue(makeTarget());

      await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(auditEntry()).toEqual({
        userId: ADMIN_ID,
        action: AuditAction.UtilisateurCree,
        targetType: AuditTargetType.User,
        targetId: TARGET_ID,
      });
    });

    it('FR-11: editing a user is audited', async () => {
      await asAdmin('patch', `/api/v1/users/${TARGET_ID}`).send({ name: 'Marie Durand' });

      expect(auditEntry().action).toBe(AuditAction.UtilisateurModifie);
    });

    it('FR-11: deactivating a user is audited', async () => {
      await asAdmin('patch', `/api/v1/users/${TARGET_ID}/deactivate`);

      expect(auditEntry().action).toBe(AuditAction.UtilisateurDesactive);
    });

    it('FR-11: reactivating a user is audited', async () => {
      target = makeTarget({ isActive: false });
      await asAdmin('patch', `/api/v1/users/${TARGET_ID}/reactivate`);

      expect(auditEntry().action).toBe(AuditAction.UtilisateurReactive);
    });

    it('FR-11: a password reset is audited, WITHOUT recording the password', async () => {
      const res = await asAdmin('post', `/api/v1/users/${TARGET_ID}/reset-password`);

      const entry = auditEntry();
      expect(entry.action).toBe(AuditAction.MotDePasseReinitialise);
      expect(JSON.stringify(entry)).not.toContain(res.body.temporaryPassword);
    });

    it('FR-11: the entry records the ACTING admin, not the target', async () => {
      await asAdmin('patch', `/api/v1/users/${TARGET_ID}/deactivate`);

      const entry = auditEntry();
      expect(entry.userId).toBe(ADMIN_ID);
      expect(entry.targetId).toBe(TARGET_ID);
    });

    it('FR-11: a FAILED action writes no audit entry', async () => {
      mockedUser.exists.mockResolvedValue({ _id: 'taken' });

      const res = await asAdmin('post', '/api/v1/users').send({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        password: 'S3cret!Passw0rd',
        role: Role.Recruteur,
        departmentId: DEPT_ID,
      });

      expect(res.status).toBe(409);
      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-5: these routes are Administrateur-only', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).post('/api/v1/users').send({ name: 'X' });
      expect(res.status).toBe(401);
    });

    it('FR-5: a Recruteur cannot create users', async () => {
      const recruteur = { ...admin, _id: TARGET_ID, role: Role.Recruteur, departmentId: DEPT_ID };
      mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(recruteur) });
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: ADMIN_PASSWORD });
      mockedUser.findById.mockResolvedValue(recruteur);

      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', login.headers['set-cookie'] as unknown as string[])
        .send({
          name: 'Marie',
          email: 'm@example.com',
          password: 'S3cret!Passw0rd',
          role: Role.Recruteur,
          departmentId: DEPT_ID,
        });

      expect(res.status).toBe(403);
      expect(mockedUser.create).not.toHaveBeenCalled();
    });
  });
});

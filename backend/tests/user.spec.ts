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
const RECRUTEUR_ID = new Types.ObjectId().toString();

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

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Recruteur',
  email: 'recruteur@example.com',
  passwordHash: adminHash,
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
};

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
    if (key === RECRUTEUR_ID) return Promise.resolve(recruteur);
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

  /**
   * D-073 — the ONE read a Recruteur may perform on this module, so that FR-30
   * has an interviewer picker at all. Every test here is a boundary test: the
   * point is not that the allowed call works, it is that nothing NEXT to it
   * does.
   */
  describe('D-073: the Recruteur carve-out on GET /users', () => {
    const find = () => (mockedUser as unknown as { find: jest.Mock }).find;

    const listResolves = (users: unknown[]) => {
      (mockedUser as unknown as { find: jest.Mock }).find = jest
        .fn()
        .mockReturnValue({ sort: jest.fn().mockResolvedValue(users) });
    };

    const responsable = (overrides: Record<string, unknown> = {}) => ({
      _id: new Types.ObjectId().toString(),
      name: 'Claire Morel',
      email: 'claire@example.com',
      role: Role.ResponsableHierarchique,
      departmentId: DEPT_ID,
      isActive: true,
      mustChangePassword: false,
      ...overrides,
    });

    let recruteurCookie: string[];

    beforeEach(async () => {
      mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(recruteur) });
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'recruteur@example.com', password: ADMIN_PASSWORD });
      expect(login.status).toBe(200);
      recruteurCookie = login.headers['set-cookie'] as unknown as string[];
      listResolves([responsable()]);
    });

    const asRecruteur = (method: 'get' | 'post' | 'patch', url: string) =>
      request(app)[method](url).set('Cookie', recruteurCookie);

    it('FR-30: role=ResponsableHierarchique is allowed, and is silently narrowed to ACTIVE accounts', async () => {
      const res = await asRecruteur('get', `/api/v1/users?role=${Role.ResponsableHierarchique}`);

      expect(res.status).toBe(200);
      // `isActive: true` is added by the service, not asked for by the caller:
      // D-043 refuses a deactivated interviewer, so offering one would be an
      // option that can only produce a 400.
      expect(find()).toHaveBeenCalledWith({
        role: Role.ResponsableHierarchique,
        isActive: true,
      });
    });

    it('FR-30: departmentId narrows the picker to the department of the poste', async () => {
      await asRecruteur(
        'get',
        `/api/v1/users?role=${Role.ResponsableHierarchique}&departmentId=${DEPT_ID}`,
      );

      expect(find()).toHaveBeenCalledWith({
        role: Role.ResponsableHierarchique,
        isActive: true,
        departmentId: DEPT_ID,
      });
    });

    it('a malformed departmentId is a 400, not a 500 from the ObjectId cast', async () => {
      const res = await asRecruteur(
        'get',
        `/api/v1/users?role=${Role.ResponsableHierarchique}&departmentId=not-an-id`,
      );

      expect(res.status).toBe(400);
      expect(find()).not.toHaveBeenCalled();
    });

    it('NO role filter is a 403 — never a silent full directory', async () => {
      const res = await asRecruteur('get', '/api/v1/users');

      expect(res.status).toBe(403);
      // The assertion that matters: the query never ran. A 403 returned after
      // reading every account would still be a read of every account.
      expect(find()).not.toHaveBeenCalled();
    });

    it('role=Recruteur is a 403 — the carve-out is one role wide, not "any filter"', async () => {
      const res = await asRecruteur('get', `/api/v1/users?role=${Role.Recruteur}`);

      expect(res.status).toBe(403);
      expect(find()).not.toHaveBeenCalled();
    });

    it('role=Administrateur is a 403', async () => {
      const res = await asRecruteur('get', `/api/v1/users?role=${Role.Administrateur}`);

      expect(res.status).toBe(403);
      expect(find()).not.toHaveBeenCalled();
    });

    it('isActive=false is REFUSED, not overridden — the D-047 rule', async () => {
      const res = await asRecruteur(
        'get',
        `/api/v1/users?role=${Role.ResponsableHierarchique}&isActive=false`,
      );

      expect(res.status).toBe(403);
      expect(find()).not.toHaveBeenCalled();
    });

    it('the Recruteur gets the PICKER shape: id, name, departmentId — and nothing else', async () => {
      listResolves([{ ...responsable(), passwordHash: '$2b$10$leaked' }]);

      const res = await asRecruteur('get', `/api/v1/users?role=${Role.ResponsableHierarchique}`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body[0]).sort()).toEqual(['departmentId', 'id', 'name']);
      // Not merely absent from the interface — absent from the wire.
      const wire = JSON.stringify(res.body);
      expect(wire).not.toContain('passwordHash');
      expect(wire).not.toContain('claire@example.com');
      expect(wire).not.toContain('mustChangePassword');
    });

    it('the Administrateur keeps the FULL FR-12 shape — D-073 narrowed nobody else', async () => {
      listResolves([responsable()]);

      const res = await asAdmin('get', `/api/v1/users?role=${Role.ResponsableHierarchique}`);

      expect(res.status).toBe(200);
      expect(res.body[0].email).toBe('claire@example.com');
      expect(res.body[0].mustChangePassword).toBe(false);
      // And no `isActive: true` is forced on them: FR-12 lists every account.
      expect(find()).toHaveBeenCalledWith({ role: Role.ResponsableHierarchique });
    });

    it('GET /users/:id stays Administrateur-only — only the LIST was opened', async () => {
      const res = await asRecruteur('get', `/api/v1/users/${TARGET_ID}`);
      expect(res.status).toBe(403);
    });

    it('management operations are untouched: a Recruteur still cannot deactivate', async () => {
      const res = await asRecruteur('patch', `/api/v1/users/${TARGET_ID}/deactivate`);

      expect(res.status).toBe(403);
      expect(target.save).not.toHaveBeenCalled();
    });

    it('management operations are untouched: a Recruteur still cannot reset a password', async () => {
      const res = await asRecruteur('post', `/api/v1/users/${TARGET_ID}/reset-password`);

      expect(res.status).toBe(403);
      expect(res.body.temporaryPassword).toBeUndefined();
    });

    it('rule 1: the carve-out did not un-authenticate the route', async () => {
      const res = await request(app).get(`/api/v1/users?role=${Role.ResponsableHierarchique}`);
      expect(res.status).toBe(401);
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

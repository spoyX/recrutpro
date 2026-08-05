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

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedDepartment = Department as unknown as {
  find: jest.Mock;
  findById: jest.Mock;
  exists: jest.Mock;
  create: jest.Mock;
};
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const ADMIN_ID = new Types.ObjectId().toString();
const RECRUTEUR_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();

const admin = {
  _id: ADMIN_ID,
  name: 'Admin',
  email: 'admin@example.com',
  passwordHash,
  role: Role.Administrateur,
  isActive: true,
  mustChangePassword: false,
};

const recruteur = {
  ...admin,
  _id: RECRUTEUR_ID,
  email: 'marie@example.com',
  role: Role.Recruteur,
  departmentId: DEPT_ID,
};

let department: {
  _id: string;
  name: string;
  isActive: boolean;
  save: jest.Mock;
};

const auditEntry = () => {
  expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
  return mockedAuditLog.create.mock.calls[0][0];
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

let adminCookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  department = {
    _id: DEPT_ID,
    name: 'Ingénierie',
    isActive: true,
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedDepartment.findById.mockResolvedValue(department);
  mockedDepartment.exists.mockResolvedValue(null);
  mockedDepartment.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([department]) });
  mockedAuditLog.create.mockResolvedValue({});

  adminCookie = await signInAs(admin);
});

afterAll(async () => {
  await closeSessionStore();
});

const asAdmin = (method: 'get' | 'post' | 'patch', url: string) =>
  request(app)[method](url).set('Cookie', adminCookie);

describe('Department management — FR-13', () => {
  it('FR-13: creates a department', async () => {
    mockedDepartment.create.mockResolvedValue(department);

    const res = await asAdmin('post', '/api/v1/departments').send({ name: '  Ingénierie  ' });

    expect(res.status).toBe(201);
    // Trimmed, so " Ingénierie " and "Ingénierie" cannot coexist.
    expect(mockedDepartment.create).toHaveBeenCalledWith({ name: 'Ingénierie', isActive: true });
    expect(res.body).toEqual({ id: DEPT_ID, name: 'Ingénierie', isActive: true });
  });

  it('FR-13 / D-016: a duplicate name is rejected with 409', async () => {
    mockedDepartment.exists.mockResolvedValue({ _id: 'other' });

    const res = await asAdmin('post', '/api/v1/departments').send({ name: 'Ingénierie' });

    expect(res.status).toBe(409);
    expect(mockedDepartment.create).not.toHaveBeenCalled();
  });

  it('FR-13: renames a department', async () => {
    const res = await asAdmin('patch', `/api/v1/departments/${DEPT_ID}`).send({ name: 'R&D' });

    expect(res.status).toBe(200);
    expect(department.name).toBe('R&D');
    expect(department.save).toHaveBeenCalled();
  });

  it('FR-13: renaming to its OWN current name is not a conflict', async () => {
    // The clash check must exclude the document being renamed.
    const res = await asAdmin('patch', `/api/v1/departments/${DEPT_ID}`).send({
      name: 'Ingénierie',
    });

    expect(res.status).toBe(200);
    const clashQuery = mockedDepartment.exists.mock.calls[0][0];
    expect(clashQuery._id).toEqual({ $ne: DEPT_ID });
  });

  it('FR-13: renaming onto another department’s name is a 409', async () => {
    mockedDepartment.exists.mockResolvedValue({ _id: 'someone-else' });

    const res = await asAdmin('patch', `/api/v1/departments/${DEPT_ID}`).send({ name: 'Ventes' });

    expect(res.status).toBe(409);
    expect(department.save).not.toHaveBeenCalled();
  });

  it('FR-13: deactivating flags the record, never deletes it', async () => {
    const res = await asAdmin('patch', `/api/v1/departments/${DEPT_ID}/deactivate`);

    expect(res.status).toBe(200);
    expect(department.isActive).toBe(false);
    // History preserved — same document, still named.
    expect(department.name).toBe('Ingénierie');
  });

  it('D-035: reactivating restores it', async () => {
    department.isActive = false;

    const res = await asAdmin('patch', `/api/v1/departments/${DEPT_ID}/reactivate`);

    expect(res.status).toBe(200);
    expect(department.isActive).toBe(true);
  });

  it('FR-13: an unknown department is a 404', async () => {
    mockedDepartment.findById.mockResolvedValue(null);

    const res = await asAdmin('patch', `/api/v1/departments/${new Types.ObjectId()}`).send({
      name: 'X',
    });

    expect(res.status).toBe(404);
  });

  describe('FR-13: listing hides deactivated departments by default', () => {
    it('FR-13: the default list filters to active only', async () => {
      await asAdmin('get', '/api/v1/departments');

      expect(mockedDepartment.find).toHaveBeenCalledWith({ isActive: true });
    });

    it('FR-13: includeInactive=true returns everything, for administration', async () => {
      await asAdmin('get', '/api/v1/departments?includeInactive=true');

      expect(mockedDepartment.find).toHaveBeenCalledWith({});
    });
  });

  describe('FR-5: who may do what', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/v1/departments');
      expect(res.status).toBe(401);
    });

    it('FR-14: a Recruteur CAN read the list, to pick one for a job position', async () => {
      const cookie = await signInAs(recruteur);

      const res = await request(app).get('/api/v1/departments').set('Cookie', cookie);

      expect(res.status).toBe(200);
    });

    it('FR-13: a Recruteur CANNOT create a department', async () => {
      const cookie = await signInAs(recruteur);

      const res = await request(app)
        .post('/api/v1/departments')
        .set('Cookie', cookie)
        .send({ name: 'Pirate' });

      expect(res.status).toBe(403);
      expect(mockedDepartment.create).not.toHaveBeenCalled();
    });
  });

  describe('D-034 / rule 4: department actions are audited', () => {
    it('D-034: creation is audited', async () => {
      mockedDepartment.create.mockResolvedValue(department);
      await asAdmin('post', '/api/v1/departments').send({ name: 'Ingénierie' });

      expect(auditEntry()).toEqual({
        userId: ADMIN_ID,
        action: AuditAction.DepartementCree,
        targetType: AuditTargetType.Department,
        targetId: DEPT_ID,
      });
    });

    it('D-034: renaming is audited', async () => {
      await asAdmin('patch', `/api/v1/departments/${DEPT_ID}`).send({ name: 'R&D' });
      expect(auditEntry().action).toBe(AuditAction.DepartementModifie);
    });

    it('D-034: deactivation is audited', async () => {
      await asAdmin('patch', `/api/v1/departments/${DEPT_ID}/deactivate`);
      expect(auditEntry().action).toBe(AuditAction.DepartementDesactive);
    });

    it('D-034: reactivation is audited', async () => {
      await asAdmin('patch', `/api/v1/departments/${DEPT_ID}/reactivate`);
      expect(auditEntry().action).toBe(AuditAction.DepartementReactive);
    });

    it('D-034: a REJECTED action writes no audit entry', async () => {
      mockedDepartment.exists.mockResolvedValue({ _id: 'other' });

      await asAdmin('post', '/api/v1/departments').send({ name: 'Ingénierie' });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });

    it('D-034: reading the list is NOT audited', async () => {
      await asAdmin('get', '/api/v1/departments');
      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });
});

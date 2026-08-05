import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Department } from '../src/models/Department.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { assertAcceptsCandidates } from '../src/services/jobPosition.service';
import {
  Role,
  JobPositionStatus,
  AuditAction,
  AuditTargetType,
} from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Department.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedDepartment = Department as unknown as { findById: jest.Mock };
const mockedJobPosition = JobPosition as unknown as {
  create: jest.Mock;
  find: jest.Mock;
  findById: jest.Mock;
};
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();
const OTHER_DEPT_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const CREATED_AT = new Date('2026-08-01T09:00:00.000Z');

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
};

const admin = {
  ...recruteur,
  _id: new Types.ObjectId().toString(),
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined,
};

const responsable = {
  ...recruteur,
  _id: new Types.ObjectId().toString(),
  email: 'pierre@example.com',
  role: Role.ResponsableHierarchique,
};

let department: { _id: string; name: string; isActive: boolean };
let position: {
  _id: string;
  title: string;
  department: unknown;
  description: string;
  requirements?: string;
  status: JobPositionStatus;
  createdAt: Date;
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

let recruteurCookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  department = { _id: DEPT_ID, name: 'Ingénierie', isActive: true };

  position = {
    _id: POSITION_ID,
    title: 'Développeur backend',
    department: DEPT_ID,
    description: 'Conception et maintenance de nos API.',
    requirements: 'Node.js, MongoDB',
    status: JobPositionStatus.Ouvert,
    createdAt: CREATED_AT,
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedDepartment.findById.mockResolvedValue(department);
  mockedJobPosition.findById.mockResolvedValue(position);
  mockedJobPosition.create.mockResolvedValue(position);
  mockedJobPosition.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([position]) });
  mockedAuditLog.create.mockResolvedValue({});

  recruteurCookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const asRecruteur = (method: 'get' | 'post' | 'patch' | 'delete', url: string) =>
  request(app)[method](url).set('Cookie', recruteurCookie);

describe('Job positions — FR-14 to FR-18', () => {
  describe('FR-14: create', () => {
    it('FR-14: creates a position and records the creation date automatically', async () => {
      const res = await asRecruteur('post', '/api/v1/job-positions').send({
        title: '  Développeur backend  ',
        departmentId: DEPT_ID,
        description: '  Conception et maintenance de nos API.  ',
        requirements: 'Node.js, MongoDB',
        status: JobPositionStatus.Ouvert,
      });

      expect(res.status).toBe(201);
      expect(mockedJobPosition.create).toHaveBeenCalledWith({
        title: 'Développeur backend',
        department: DEPT_ID,
        description: 'Conception et maintenance de nos API.',
        requirements: 'Node.js, MongoDB',
        status: JobPositionStatus.Ouvert,
      });
      // createdAt is never taken from the request — the schema stamps it.
      expect(mockedJobPosition.create.mock.calls[0][0]).not.toHaveProperty('createdAt');
      expect(res.body.createdAt).toBe(CREATED_AT.toISOString());
    });

    it('FR-14: the default status is Brouillon', async () => {
      await asRecruteur('post', '/api/v1/job-positions').send({
        title: 'Poste',
        departmentId: DEPT_ID,
        description: 'Description',
      });

      expect(mockedJobPosition.create.mock.calls[0][0].status).toBe(JobPositionStatus.Brouillon);
    });

    it('FR-14 / D-037: a position cannot be CREATED as Clôturé', async () => {
      const res = await asRecruteur('post', '/api/v1/job-positions').send({
        title: 'Poste',
        departmentId: DEPT_ID,
        description: 'Description',
        status: JobPositionStatus.Cloture,
      });

      expect(res.status).toBe(400);
      expect(mockedJobPosition.create).not.toHaveBeenCalled();
    });

    it('FR-14: a missing required field is rejected', async () => {
      const res = await asRecruteur('post', '/api/v1/job-positions').send({
        departmentId: DEPT_ID,
        description: 'Description',
      });

      expect(res.status).toBe(400);
      expect(mockedJobPosition.create).not.toHaveBeenCalled();
    });

    it('FR-14 / D-030: a DEACTIVATED department is refused server-side', async () => {
      // FR-13 hides it from the picker; NFR-04 forbids trusting the picker.
      department.isActive = false;

      const res = await asRecruteur('post', '/api/v1/job-positions').send({
        title: 'Poste',
        departmentId: DEPT_ID,
        description: 'Description',
      });

      expect(res.status).toBe(400);
      expect(mockedJobPosition.create).not.toHaveBeenCalled();
    });

    it('FR-14: an unknown department is refused', async () => {
      mockedDepartment.findById.mockResolvedValue(null);

      const res = await asRecruteur('post', '/api/v1/job-positions').send({
        title: 'Poste',
        departmentId: OTHER_DEPT_ID,
        description: 'Description',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('FR-15: edit', () => {
    it('FR-15: edits every supplied field of an open position', async () => {
      const res = await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        title: 'Développeur senior',
        description: 'Nouvelle description',
        requirements: 'Node.js, MongoDB, Docker',
      });

      expect(res.status).toBe(200);
      expect(position.title).toBe('Développeur senior');
      expect(position.description).toBe('Nouvelle description');
      expect(position.requirements).toBe('Node.js, MongoDB, Docker');
      expect(position.save).toHaveBeenCalled();
    });

    it('FR-15: the creation date is never modified', async () => {
      await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        title: 'Autre titre',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      expect(position.createdAt).toEqual(CREATED_AT);
    });

    it('FR-15 / D-037: a BROUILLON is editable — it can be promoted to Ouvert', async () => {
      position.status = JobPositionStatus.Brouillon;

      const res = await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        status: JobPositionStatus.Ouvert,
      });

      expect(res.status).toBe(200);
      expect(position.status).toBe(JobPositionStatus.Ouvert);
    });

    it('FR-15 / D-037: a CLÔTURÉ position is not editable', async () => {
      position.status = JobPositionStatus.Cloture;

      const res = await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        title: 'Trop tard',
      });

      expect(res.status).toBe(409);
      expect(position.save).not.toHaveBeenCalled();
    });

    it('FR-16 / D-037: closing via PATCH status is refused — use the close action', async () => {
      const res = await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        status: JobPositionStatus.Cloture,
      });

      expect(res.status).toBe(400);
      expect(position.status).toBe(JobPositionStatus.Ouvert);
      expect(position.save).not.toHaveBeenCalled();
    });

    it('FR-15: an unknown position is a 404', async () => {
      mockedJobPosition.findById.mockResolvedValue(null);

      const res = await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({
        title: 'X',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('FR-16: close', () => {
    it('FR-16: closes an open position', async () => {
      const res = await asRecruteur('post', `/api/v1/job-positions/${POSITION_ID}/close`);

      expect(res.status).toBe(200);
      expect(position.status).toBe(JobPositionStatus.Cloture);
      expect(position.save).toHaveBeenCalled();
      expect(res.body.status).toBe(JobPositionStatus.Cloture);
    });

    it('FR-16: re-closing is reported rather than silently accepted', async () => {
      position.status = JobPositionStatus.Cloture;

      const res = await asRecruteur('post', `/api/v1/job-positions/${POSITION_ID}/close`);

      expect(res.status).toBe(409);
    });

    it('FR-16: a closed position accepts no new candidate', async () => {
      // The second half of FR-16, which FR-19 will call. No HTTP caller yet.
      position.status = JobPositionStatus.Cloture;

      await expect(assertAcceptsCandidates(POSITION_ID)).rejects.toMatchObject({
        status: 409,
        code: 'POSITION_CLOSED',
      });
    });

    it('FR-16: an open position accepts candidates', async () => {
      await expect(assertAcceptsCandidates(POSITION_ID)).resolves.toBe(position);
    });
  });

  describe('FR-17: list and read', () => {
    it('FR-17: lists every position when no filter is given', async () => {
      const res = await asRecruteur('get', '/api/v1/job-positions');

      expect(res.status).toBe(200);
      expect(mockedJobPosition.find).toHaveBeenCalledWith({});
      expect(res.body).toHaveLength(1);
    });

    it('FR-17: filters by status', async () => {
      await asRecruteur('get', '/api/v1/job-positions?status=Ouvert');

      expect(mockedJobPosition.find).toHaveBeenCalledWith({ status: JobPositionStatus.Ouvert });
    });

    it('FR-17: filters by department', async () => {
      await asRecruteur('get', `/api/v1/job-positions?departmentId=${DEPT_ID}`);

      expect(mockedJobPosition.find).toHaveBeenCalledWith({ department: DEPT_ID });
    });

    it('FR-17: combines both filters', async () => {
      await asRecruteur(
        'get',
        `/api/v1/job-positions?status=Brouillon&departmentId=${DEPT_ID}`,
      );

      expect(mockedJobPosition.find).toHaveBeenCalledWith({
        status: JobPositionStatus.Brouillon,
        department: DEPT_ID,
      });
    });

    it('FR-17: an unrecognised status is a 400, not a silent empty list', async () => {
      const res = await asRecruteur('get', '/api/v1/job-positions?status=Peut-être');

      expect(res.status).toBe(400);
      expect(mockedJobPosition.find).not.toHaveBeenCalled();
    });

    it('FR-17: reads a single position', async () => {
      const res = await asRecruteur('get', `/api/v1/job-positions/${POSITION_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(POSITION_ID);
      expect(res.body.departmentId).toBe(DEPT_ID);
    });

    it('FR-17: a malformed id is a 404, not a cast error', async () => {
      const res = await asRecruteur('get', '/api/v1/job-positions/not-an-id');

      expect(res.status).toBe(404);
    });
  });

  describe('FR-18: deletion is not exposed at all', () => {
    it('FR-18: DELETE /job-positions/:id is unrouted', async () => {
      const res = await asRecruteur('delete', `/api/v1/job-positions/${POSITION_ID}`);

      // Closure is the only removal path — a position with candidates attached
      // must never disappear, so no delete route exists to guard.
      expect(res.status).toBe(404);
    });

    it('FR-18: DELETE /job-positions is unrouted', async () => {
      const res = await asRecruteur('delete', '/api/v1/job-positions');

      expect(res.status).toBe(404);
    });
  });

  describe('FR-5 / D-037: only a Recruteur reaches this module', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).get('/api/v1/job-positions');

      expect(res.status).toBe(401);
    });

    it('D-037: an Administrateur is 403 — no FR grants it job positions', async () => {
      const cookie = await signInAs(admin);

      const res = await request(app).get('/api/v1/job-positions').set('Cookie', cookie);

      expect(res.status).toBe(403);
    });

    it('D-037: a Responsable hiérarchique is 403', async () => {
      const cookie = await signInAs(responsable);

      const res = await request(app)
        .post('/api/v1/job-positions')
        .set('Cookie', cookie)
        .send({ title: 'Poste', departmentId: DEPT_ID, description: 'Description' });

      expect(res.status).toBe(403);
      expect(mockedJobPosition.create).not.toHaveBeenCalled();
    });
  });

  describe('D-036 / rule 4: job position actions are audited', () => {
    it('D-036: creation is audited, against the ACTING recruiter', async () => {
      await asRecruteur('post', '/api/v1/job-positions').send({
        title: 'Poste',
        departmentId: DEPT_ID,
        description: 'Description',
      });

      expect(auditEntry()).toEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.PosteCree,
        targetType: AuditTargetType.JobPosition,
        targetId: POSITION_ID,
      });
    });

    it('D-036: editing is audited', async () => {
      await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({ title: 'Autre' });

      expect(auditEntry().action).toBe(AuditAction.PosteModifie);
    });

    it('D-036: closing is audited', async () => {
      await asRecruteur('post', `/api/v1/job-positions/${POSITION_ID}/close`);

      expect(auditEntry().action).toBe(AuditAction.PosteCloture);
    });

    it('D-036: a REJECTED action writes no audit entry', async () => {
      position.status = JobPositionStatus.Cloture;

      await asRecruteur('patch', `/api/v1/job-positions/${POSITION_ID}`).send({ title: 'X' });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });

    it('D-036: reading is NOT audited', async () => {
      await asRecruteur('get', '/api/v1/job-positions');
      await asRecruteur('get', `/api/v1/job-positions/${POSITION_ID}`);

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });
});

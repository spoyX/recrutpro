import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Role, CandidateStage, JobPositionStatus } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { create: jest.Mock; findOne: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const REGISTERED_AT = new Date('2026-08-05T10:00:00.000Z');

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

const VALID_BODY = {
  fullName: '  Jean Martin  ',
  email: '  Jean.Martin@Example.COM  ',
  phone: '  0612345678  ',
  jobPositionId: POSITION_ID,
};

let position: { _id: string; status: JobPositionStatus };
let created: Record<string, unknown>;

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

  position = { _id: POSITION_ID, status: JobPositionStatus.Ouvert };

  created = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    email: 'jean.martin@example.com',
    phone: '0612345678',
    jobPositionId: POSITION_ID,
    currentStage: CandidateStage.CandidatureRecue,
    registeredBy: RECRUTEUR_ID,
    registeredAt: REGISTERED_AT,
  };

  mockedJobPosition.findById.mockResolvedValue(position);
  mockedCandidate.findOne.mockResolvedValue(null);
  mockedCandidate.create.mockResolvedValue(created);
  mockedAuditLog.create.mockResolvedValue({});

  recruteurCookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const post = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/candidates').set('Cookie', recruteurCookie).send(body);

describe('Candidate registration — FR-19, FR-20', () => {
  describe('FR-19: register a candidate', () => {
    it('FR-19: registers a candidate and returns it', async () => {
      const res = await post(VALID_BODY);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(CANDIDATE_ID);
      expect(res.body.jobPositionId).toBe(POSITION_ID);
    });

    it('FR-19: the initial stage is ALWAYS "Candidature reçue"', async () => {
      await post(VALID_BODY);

      expect(mockedCandidate.create.mock.calls[0][0].currentStage).toBe(
        CandidateStage.CandidatureRecue,
      );
    });

    it('FR-19 / D-006: a client-supplied stage is ignored, never persisted', async () => {
      await post({ ...VALID_BODY, currentStage: CandidateStage.Accepte });

      // Section 8: a stage is a side effect of a service action, never a value
      // a client may assign — least of all straight to a terminal stage.
      expect(mockedCandidate.create.mock.calls[0][0].currentStage).toBe(
        CandidateStage.CandidatureRecue,
      );
    });

    it('FR-19: fields are trimmed and the email is lowercased', async () => {
      await post(VALID_BODY);

      expect(mockedCandidate.create.mock.calls[0][0]).toMatchObject({
        fullName: 'Jean Martin',
        email: 'jean.martin@example.com',
        phone: '0612345678',
      });
    });

    it('FR-19: the candidate is attributed to the acting recruiter', async () => {
      await post(VALID_BODY);

      expect(String(mockedCandidate.create.mock.calls[0][0].registeredBy)).toBe(RECRUTEUR_ID);
    });

    it('FR-24 / D-018: registeredAt is never taken from the request body', async () => {
      await post({ ...VALID_BODY, registeredAt: '2020-01-01T00:00:00.000Z' });

      // The model stamps it server-side; the service must not pass one through.
      expect(mockedCandidate.create.mock.calls[0][0]).not.toHaveProperty('registeredAt');
    });

    it.each([
      ['fullName', 'nom complet'],
      ['email', 'email'],
      ['phone', 'téléphone'],
      ['jobPositionId', 'poste'],
    ])('FR-19: %s is required', async (field) => {
      const body: Record<string, unknown> = { ...VALID_BODY };
      delete body[field];

      const res = await post(body);

      expect(res.status).toBe(400);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-19: a blank field is rejected, not stored as an empty string', async () => {
      const res = await post({ ...VALID_BODY, fullName: '   ' });

      expect(res.status).toBe(400);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-16: a closed position accepts no candidate', () => {
    it('FR-16: registering on a CLOSED position is refused', async () => {
      position.status = JobPositionStatus.Cloture;

      const res = await post(VALID_BODY);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POSITION_CLOSED');
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-16: a BROUILLON position still accepts candidates', async () => {
      // Only closure blocks registration — FR-16 says nothing about drafts.
      position.status = JobPositionStatus.Brouillon;

      const res = await post(VALID_BODY);

      expect(res.status).toBe(201);
    });

    it('FR-19: an unknown position is a 404', async () => {
      mockedJobPosition.findById.mockResolvedValue(null);

      const res = await post(VALID_BODY);

      expect(res.status).toBe(404);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-19: a malformed position id is a 404, not a cast error', async () => {
      const res = await post({ ...VALID_BODY, jobPositionId: 'not-an-id' });

      expect(res.status).toBe(404);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-16: the position is checked BEFORE the duplicate lookup', async () => {
      // A closed position makes the duplicate question moot, and checking it
      // first means a closed position never reveals who already applied.
      position.status = JobPositionStatus.Cloture;

      await post(VALID_BODY);

      expect(mockedCandidate.findOne).not.toHaveBeenCalled();
    });
  });

  describe('FR-20 / D-004: duplicate detection', () => {
    const existing = {
      _id: new Types.ObjectId().toString(),
      fullName: 'Jean Martin',
      email: 'jean.martin@example.com',
      registeredAt: REGISTERED_AT,
    };

    it('FR-20: a duplicate on the SAME position warns instead of creating', async () => {
      mockedCandidate.findOne.mockResolvedValue(existing);

      const res = await post(VALID_BODY);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_CANDIDATE');
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-20 / NFR-09: the warning names the existing candidate and the way out', async () => {
      mockedCandidate.findOne.mockResolvedValue(existing);

      const res = await post(VALID_BODY);

      expect(res.body.error.message).toContain('Jean Martin');
      expect(res.body.error.message).toContain('2026-08-05');
      expect(res.body.error.message).toContain('confirmDuplicate');
    });

    it('FR-20 / D-004: the lookup is scoped to email AND jobPositionId', async () => {
      await post(VALID_BODY);

      // Never a global email lookup — the same person may apply elsewhere.
      expect(mockedCandidate.findOne).toHaveBeenCalledWith({
        email: 'jean.martin@example.com',
        jobPositionId: POSITION_ID,
      });
    });

    it('FR-20: the scoped lookup uses the NORMALISED email', async () => {
      // "Jean.Martin@Example.COM " must find a stored "jean.martin@example.com",
      // or the duplicate check silently never matches anything.
      await post(VALID_BODY);

      expect(mockedCandidate.findOne.mock.calls[0][0].email).toBe('jean.martin@example.com');
    });

    it('FR-20: confirmDuplicate lets the recruiter create it anyway', async () => {
      mockedCandidate.findOne.mockResolvedValue(existing);

      const res = await post({ ...VALID_BODY, confirmDuplicate: true });

      expect(res.status).toBe(201);
      expect(mockedCandidate.create).toHaveBeenCalled();
    });

    it('FR-20: a truthy NON-boolean does not confirm a duplicate', async () => {
      mockedCandidate.findOne.mockResolvedValue(existing);

      // The string "false" is truthy — the classic way a confirmation flag
      // waves through exactly what it was meant to stop.
      const res = await post({ ...VALID_BODY, confirmDuplicate: 'false' });

      expect(res.status).toBe(409);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-20: no duplicate means no warning', async () => {
      const res = await post(VALID_BODY);

      expect(res.status).toBe(201);
    });
  });

  describe('FR-5: who may register a candidate', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).post('/api/v1/candidates').send(VALID_BODY);

      expect(res.status).toBe(401);
    });

    it('FR-19: an Administrateur cannot register a candidate', async () => {
      const cookie = await signInAs(admin);

      const res = await request(app)
        .post('/api/v1/candidates')
        .set('Cookie', cookie)
        .send(VALID_BODY);

      expect(res.status).toBe(403);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });

    it('FR-19: a Responsable hiérarchique cannot register a candidate', async () => {
      const cookie = await signInAs(responsable);

      const res = await request(app)
        .post('/api/v1/candidates')
        .set('Cookie', cookie)
        .send(VALID_BODY);

      expect(res.status).toBe(403);
      expect(mockedCandidate.create).not.toHaveBeenCalled();
    });
  });

  describe('D-039: registration is not audited', () => {
    it('D-039: registration writes no AuditLog entry', async () => {
      await post(VALID_BODY);

      // registeredBy + registeredAt live on the candidate document itself and
      // are immutable, so an audit entry would duplicate what the domain model
      // already keeps permanently. Rule 4 requires candidate STAGE CHANGES,
      // which land with FR-25.
      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });
});

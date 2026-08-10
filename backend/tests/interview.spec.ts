import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Interview } from '../src/models/Interview.model';
import { Notification } from '../src/models/Notification.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { CONFLICT_BUFFER_MS } from '../src/services/interview.service';
import {
  Role,
  CandidateStage,
  InterviewStatus,
  AuditAction,
  AuditTargetType,
  NotificationType,
} from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/Notification.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };
const mockedInterview = Interview as unknown as { create: jest.Mock; findOne: jest.Mock };
const mockedNotification = Notification as unknown as { insertMany: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

/** Every notification row written across the whole action, flattened. */
const allNotified = (): Array<Record<string, unknown>> =>
  mockedNotification.insertMany.mock.calls.flatMap((call) => call[0]);

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const OWNER_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();
const OTHER_DEPT_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const POSITION_ID = new Types.ObjectId().toString();
const INTERVIEWER_ID = new Types.ObjectId().toString();
const INTERVIEW_ID = new Types.ObjectId().toString();

/** Always in the future, so the D-043 past-date guard never fires by accident. */
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
const admin = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'admin@example.com', role: Role.Administrateur };
const responsableLogin = { ...recruteur, _id: INTERVIEWER_ID, email: 'pierre@example.com', role: Role.ResponsableHierarchique };

let candidate: {
  _id: string;
  fullName: string;
  jobPositionId: string;
  registeredBy: string;
  currentStage: CandidateStage;
  save: jest.Mock;
};
let interviewer: {
  _id: string;
  role: Role;
  departmentId: string;
  isActive: boolean;
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

  candidate = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    jobPositionId: POSITION_ID,
    registeredBy: RECRUTEUR_ID,
    currentStage: CandidateStage.PreselectionCvValidee,
    save: jest.fn().mockResolvedValue(undefined),
  };
  interviewer = {
    _id: INTERVIEWER_ID,
    role: Role.ResponsableHierarchique,
    departmentId: DEPT_ID,
    isActive: true,
  };

  mockedCandidate.findById.mockResolvedValue(candidate);
  mockedJobPosition.findById.mockResolvedValue({
    _id: POSITION_ID,
    department: DEPT_ID,
    createdBy: OWNER_ID,
  });
  mockedNotification.insertMany.mockResolvedValue([]);
  mockedInterview.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
  mockedInterview.create.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: INTERVIEW_ID,
    ...doc,
    status: InterviewStatus.Planifie,
  }));
  mockedAuditLog.create.mockResolvedValue({});

  cookie = await signInAs(recruteur);
  // signInAs points findById at the logged-in user; scheduling looks the
  // INTERVIEWER up through the same call, so re-point it afterwards.
  mockedUser.findById.mockImplementation(async (id: unknown) =>
    String(id) === INTERVIEWER_ID ? interviewer : recruteur,
  );
});

afterAll(async () => {
  await closeSessionStore();
});

const schedule = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/interviews').set('Cookie', cookie).send(body);

const validBody = () => ({
  candidateId: CANDIDATE_ID,
  interviewerId: INTERVIEWER_ID,
  scheduledAt: FUTURE.toISOString(),
});

/** A conflicting interview `offsetMs` away from the requested slot. */
const conflictAt = (offsetMs: number) => {
  mockedInterview.findOne.mockReturnValue({
    populate: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId().toString(),
      scheduledAt: new Date(FUTURE.getTime() + offsetMs),
      candidateId: { fullName: 'Alice Durand' },
    }),
  });
};

describe('Interview scheduling — FR-30, FR-31, FR-32 (and FR-27)', () => {
  describe('FR-30: the happy path', () => {
    it('FR-30: schedules an interview', async () => {
      const res = await schedule(validBody());

      expect(res.status).toBe(201);
      expect(res.body.candidateId).toBe(CANDIDATE_ID);
      expect(res.body.interviewerId).toBe(INTERVIEWER_ID);
      expect(res.body.status).toBe(InterviewStatus.Planifie);
    });

    it('FR-27: the candidate moves to "Entretien planifié"', async () => {
      await schedule(validBody());

      expect(candidate.currentStage).toBe(CandidateStage.EntretienPlanifie);
      expect(candidate.save).toHaveBeenCalled();
    });

    it('D-044 / rule 4: scheduling itself is audited against the Interview', async () => {
      await schedule(validBody());

      expect(mockedAuditLog.create.mock.calls.map((c) => c[0])).toContainEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.EntretienPlanifie,
        targetType: AuditTargetType.Interview,
        targetId: INTERVIEW_ID,
      });
    });

    it('FR-27 / rule 4: the stage change is audited against the Candidate', async () => {
      await schedule(validBody());

      expect(mockedAuditLog.create.mock.calls.map((c) => c[0])).toContainEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.EtapeCandidatModifiee,
        targetType: AuditTargetType.Candidate,
        targetId: CANDIDATE_ID,
      });
    });

    it('D-044: one scheduling writes exactly TWO entries, one per entity', async () => {
      // Two distinct facts about two distinct entities, so an auditor
      // filtering by targetType finds each under its own.
      await schedule(validBody());

      expect(mockedAuditLog.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('FR-30: the candidate must be CV-validated', () => {
    const wrongStages = [
      CandidateStage.CandidatureRecue,
      CandidateStage.RejeteCv,
      CandidateStage.EntretienPlanifie,
      CandidateStage.EvaluationCompletee,
      CandidateStage.Accepte,
      CandidateStage.Rejete,
    ];

    for (const stage of wrongStages) {
      it(`FR-30: a candidate at "${stage}" cannot be scheduled`, async () => {
        candidate.currentStage = stage;

        const res = await schedule(validBody());

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
        expect(mockedInterview.create).not.toHaveBeenCalled();
        expect(mockedAuditLog.create).not.toHaveBeenCalled();
      });
    }

    it('FR-30: an unknown candidate is a 404', async () => {
      mockedCandidate.findById.mockResolvedValue(null);

      const res = await schedule(validBody());

      expect(res.status).toBe(404);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-30: the interviewer must belong to the job’s department', () => {
    it('FR-30: an interviewer from ANOTHER department is refused', async () => {
      interviewer.departmentId = OTHER_DEPT_ID;

      const res = await schedule(validBody());

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('FR-30: a Recruteur cannot be the interviewer', async () => {
      interviewer.role = Role.Recruteur;

      const res = await schedule(validBody());

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('FR-30: an Administrateur cannot be the interviewer', async () => {
      interviewer.role = Role.Administrateur;

      const res = await schedule(validBody());

      expect(res.status).toBe(400);
    });

    it('FR-30 / FR-8: a DEACTIVATED interviewer is refused', async () => {
      interviewer.isActive = false;

      const res = await schedule(validBody());

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('FR-30: the department comes from the POSITION, not the request', async () => {
      // NFR-04: the client cannot nominate the department the check runs against.
      await schedule({ ...validBody(), departmentId: OTHER_DEPT_ID });

      expect(mockedJobPosition.findById).toHaveBeenCalledWith(POSITION_ID);
      expect(mockedInterview.create).toHaveBeenCalled();
    });

    it('FR-30: an unknown interviewer is refused', async () => {
      mockedUser.findById.mockImplementation(async (id: unknown) =>
        String(id) === INTERVIEWER_ID ? null : recruteur,
      );

      const res = await schedule(validBody());

      expect(res.status).toBe(400);
    });
  });

  describe('FR-31 / FR-32 / D-005: conflict detection', () => {
    it('FR-31: queries a 30-minute window either side of the slot', async () => {
      await schedule(validBody());

      const query = mockedInterview.findOne.mock.calls[0][0];
      expect(query.scheduledAt.$gte.getTime()).toBe(FUTURE.getTime() - CONFLICT_BUFFER_MS);
      expect(query.scheduledAt.$lte.getTime()).toBe(FUTURE.getTime() + CONFLICT_BUFFER_MS);
      expect(query.interviewerId).toBe(INTERVIEWER_ID);
    });

    it('FR-31 / D-043: CANCELLED interviews are not conflicts', async () => {
      // Otherwise a cancelled slot would block rescheduling forever.
      await schedule(validBody());

      expect(mockedInterview.findOne.mock.calls[0][0].status).toBe(InterviewStatus.Planifie);
    });

    it('FR-32: a conflict is a 409 warning, and nothing is created', async () => {
      conflictAt(10 * 60 * 1000);

      const res = await schedule(validBody());

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SCHEDULING_CONFLICT');
      expect(mockedInterview.create).not.toHaveBeenCalled();
      expect(candidate.currentStage).toBe(CandidateStage.PreselectionCvValidee);
    });

    it('FR-32: the warning names the conflicting candidate and time', async () => {
      conflictAt(-15 * 60 * 1000);

      const res = await schedule(validBody());

      expect(res.body.error.message).toContain('Alice Durand');
      expect(res.body.error.message).toContain('confirmDespiteConflict');
    });

    it('FR-32: confirmDespiteConflict overrides the warning', async () => {
      conflictAt(10 * 60 * 1000);

      const res = await schedule({ ...validBody(), confirmDespiteConflict: true });

      expect(res.status).toBe(201);
      expect(mockedInterview.create).toHaveBeenCalled();
      expect(candidate.currentStage).toBe(CandidateStage.EntretienPlanifie);
    });

    it('FR-32: the override skips the conflict lookup entirely', async () => {
      await schedule({ ...validBody(), confirmDespiteConflict: true });

      expect(mockedInterview.findOne).not.toHaveBeenCalled();
    });

    it('FR-32: confirmDespiteConflict must be a boolean', async () => {
      const res = await schedule({ ...validBody(), confirmDespiteConflict: 'yes' });

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-30: request validation', () => {
    it('FR-30: a missing candidateId is refused', async () => {
      const res = await schedule({ interviewerId: INTERVIEWER_ID, scheduledAt: FUTURE.toISOString() });

      expect(res.status).toBe(400);
    });

    it('FR-30: a missing interviewerId is refused', async () => {
      const res = await schedule({ candidateId: CANDIDATE_ID, scheduledAt: FUTURE.toISOString() });

      expect(res.status).toBe(400);
    });

    it('FR-30: an unparseable date is refused', async () => {
      const res = await schedule({ ...validBody(), scheduledAt: 'demain matin' });

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('D-043: a date in the PAST is refused', async () => {
      const res = await schedule({
        ...validBody(),
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      });

      expect(res.status).toBe(400);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-5 / D-043: Recruteur only', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app).post('/api/v1/interviews').send(validBody());

      expect(res.status).toBe(401);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur is 403', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app)
        .post('/api/v1/interviews')
        .set('Cookie', adminCookie)
        .send(validBody());

      expect(res.status).toBe(403);
      expect(mockedInterview.create).not.toHaveBeenCalled();
    });

    it('FR-5: a Responsable hiérarchique cannot schedule — FR-30 says "le recruteur"', async () => {
      const responsableCookie = await signInAs(responsableLogin);

      const res = await request(app)
        .post('/api/v1/interviews')
        .set('Cookie', responsableCookie)
        .send(validBody());

      expect(res.status).toBe(403);
    });
  });

  describe('D-006: FR-27 is not reachable over HTTP', () => {
    it('D-006: there is no route that sets "Entretien planifié" directly', async () => {
      const res = await request(app)
        .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
        .set('Cookie', cookie)
        .send({ targetStage: CandidateStage.EntretienPlanifie });

      // The CV-review route accepts only its own two stages (D-042).
      expect(res.status).toBe(400);
      expect(candidate.currentStage).toBe(CandidateStage.PreselectionCvValidee);
    });
  });

  describe('FR-42 / FR-40: scheduling notifies the interviewer and the recruiter', () => {
    it('FR-42: the interviewer is told an interview was assigned to them', async () => {
      await schedule(validBody());

      const forInterviewer = allNotified().filter(
        (r) => String(r.userId) === INTERVIEWER_ID,
      );
      expect(forInterviewer).toHaveLength(1);
      expect(forInterviewer[0].type).toBe(NotificationType.EntretienPlanifie);
      expect(forInterviewer[0].message).toContain('Jean Martin');
    });

    it('FR-40: the responsible recruiter gets the stage-change notification', async () => {
      await schedule(validBody());

      const forOwner = allNotified().filter((r) => String(r.userId) === OWNER_ID);
      expect(forOwner).toHaveLength(1);
      expect(forOwner[0].type).toBe(NotificationType.ChangementEtape);
      expect(forOwner[0].message).toContain(CandidateStage.EntretienPlanifie);
    });

    it('D-055: the interviewer gets exactly ONE row, not a stage change as well', async () => {
      // FR-40's conditional second recipient is deliberately not passed at this
      // site, because FR-42's message is the more specific of the two.
      await schedule(validBody());

      const rows = allNotified();
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => String(r.userId) === INTERVIEWER_ID)).toHaveLength(1);
    });

    it('D-055: the acting recruiter is not notified when they own the position', async () => {
      mockedJobPosition.findById.mockResolvedValue({
        _id: POSITION_ID,
        department: DEPT_ID,
        createdBy: RECRUTEUR_ID,
      });

      await schedule(validBody());

      const rows = allNotified();
      expect(rows).toHaveLength(1);
      expect(String(rows[0].userId)).toBe(INTERVIEWER_ID);
    });

    it('D-054: a notification failure does not fail the scheduling', async () => {
      mockedNotification.insertMany.mockRejectedValue(new Error('mongo indisponible'));

      const res = await schedule(validBody());

      expect(res.status).toBe(201);
      expect(mockedInterview.create).toHaveBeenCalled();
      expect(candidate.currentStage).toBe(CandidateStage.EntretienPlanifie);
    });

    it('FR-42: a REFUSED scheduling notifies nobody', async () => {
      candidate.currentStage = CandidateStage.CandidatureRecue;

      const res = await schedule(validBody());

      expect(res.status).toBe(409);
      expect(mockedNotification.insertMany).not.toHaveBeenCalled();
    });
  });
});

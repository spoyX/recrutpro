import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Interview } from '../src/models/Interview.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Notification } from '../src/models/Notification.model';
import { AuditLog } from '../src/models/AuditLog.model';
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
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/Notification.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedInterview = Interview as unknown as { findById: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };
const mockedNotification = Notification as unknown as { insertMany: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const OWNER_ID = new Types.ObjectId().toString();
const INTERVIEWER_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const INTERVIEW_ID = new Types.ObjectId().toString();

const notifiedRows = (): Array<Record<string, unknown>> => {
  expect(mockedNotification.insertMany).toHaveBeenCalledTimes(1);
  return mockedNotification.insertMany.mock.calls[0][0];
};

const recruteur = {
  _id: RECRUTEUR_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: new Types.ObjectId().toString(),
  isActive: true,
  mustChangePassword: false,
};
const admin = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'admin@example.com', role: Role.Administrateur };
const responsable = { ...recruteur, _id: new Types.ObjectId().toString(), email: 'pierre@example.com', role: Role.ResponsableHierarchique };

let interview: {
  _id: string;
  candidateId: string;
  interviewerId: string;
  scheduledAt: Date;
  status: InterviewStatus;
  cancellationReason?: string;
  save: jest.Mock;
};
let candidate: {
  _id: string;
  fullName: string;
  jobPositionId: string;
  registeredBy: string;
  currentStage: CandidateStage;
  save: jest.Mock;
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

  interview = {
    _id: INTERVIEW_ID,
    candidateId: CANDIDATE_ID,
    interviewerId: INTERVIEWER_ID,
    scheduledAt: new Date('2026-09-10T09:00:00.000Z'),
    status: InterviewStatus.Planifie,
    save: jest.fn().mockResolvedValue(undefined),
  };
  candidate = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    jobPositionId: new Types.ObjectId().toString(),
    registeredBy: RECRUTEUR_ID,
    currentStage: CandidateStage.EntretienPlanifie,
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedInterview.findById.mockResolvedValue(interview);
  mockedCandidate.findById.mockResolvedValue(candidate);
  mockedJobPosition.findById.mockResolvedValue({ createdBy: OWNER_ID });
  mockedNotification.insertMany.mockResolvedValue([]);
  mockedAuditLog.create.mockResolvedValue({});

  cookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const cancel = (body: Record<string, unknown>) =>
  request(app).post(`/api/v1/interviews/${INTERVIEW_ID}/cancel`).set('Cookie', cookie).send(body);

const auditActions = () => mockedAuditLog.create.mock.calls.map((c) => c[0].action);

describe('Interview cancellation — FR-34', () => {
  describe('FR-34: the happy path', () => {
    it('FR-34: cancels the interview and records the motive', async () => {
      const res = await cancel({ cancellationReason: '  Candidat indisponible.  ' });

      expect(res.status).toBe(200);
      expect(interview.status).toBe(InterviewStatus.Annule);
      expect(interview.cancellationReason).toBe('Candidat indisponible.');
      expect(interview.save).toHaveBeenCalled();
    });

    it('FR-34: the candidate returns to "Présélection CV validée"', async () => {
      await cancel({ cancellationReason: 'Motif' });

      expect(candidate.currentStage).toBe(CandidateStage.PreselectionCvValidee);
      expect(candidate.save).toHaveBeenCalled();
    });
  });

  describe('FR-34 / D-046: the motive is enforced by the SERVICE, not the schema', () => {
    it('FR-34: cancelling without a motive is a 400', async () => {
      const res = await cancel({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');
      // Nothing was written — the schema's conditional required never had to
      // fire, which is the point of checking here.
      expect(interview.save).not.toHaveBeenCalled();
      expect(candidate.save).not.toHaveBeenCalled();
      expect(interview.status).toBe(InterviewStatus.Planifie);
    });

    it('FR-34: a whitespace-only motive counts as absent', async () => {
      const res = await cancel({ cancellationReason: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANCELLATION_REASON_REQUIRED');
      expect(interview.save).not.toHaveBeenCalled();
    });

    it('FR-34: a non-string motive is rejected', async () => {
      const res = await cancel({ cancellationReason: 42 });

      expect(res.status).toBe(400);
      expect(interview.save).not.toHaveBeenCalled();
    });

    it('FR-34: the candidate is NOT reverted when the motive is missing', async () => {
      await cancel({});

      expect(candidate.currentStage).toBe(CandidateStage.EntretienPlanifie);
    });
  });

  describe('D-046: only a planned interview can be cancelled', () => {
    it('D-046: an already-cancelled interview is a 409, not double-processed', async () => {
      interview.status = InterviewStatus.Annule;
      interview.cancellationReason = 'Motif initial';

      const res = await cancel({ cancellationReason: 'Nouveau motif' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INTERVIEW_NOT_CANCELLABLE');
      // The original motive must not be overwritten.
      expect(interview.cancellationReason).toBe('Motif initial');
      expect(interview.save).not.toHaveBeenCalled();
      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });

    it('D-046: a completed interview cannot be cancelled', async () => {
      interview.status = InterviewStatus.Realise;

      const res = await cancel({ cancellationReason: 'Motif' });

      expect(res.status).toBe(409);
      expect(interview.save).not.toHaveBeenCalled();
    });

    it('D-046: status is checked BEFORE the motive', async () => {
      // Otherwise an already-cancelled interview would report a missing
      // reason, which is not the real problem.
      interview.status = InterviewStatus.Annule;

      const res = await cancel({});

      expect(res.body.error.code).toBe('INTERVIEW_NOT_CANCELLABLE');
    });

    it('FR-34: an unknown interview is a 404', async () => {
      mockedInterview.findById.mockResolvedValue(null);

      const res = await cancel({ cancellationReason: 'Motif' });

      expect(res.status).toBe(404);
    });

    it('FR-34: a malformed id is a 404, not a cast error', async () => {
      const res = await request(app)
        .post('/api/v1/interviews/not-an-id/cancel')
        .set('Cookie', cookie)
        .send({ cancellationReason: 'Motif' });

      expect(res.status).toBe(404);
    });
  });

  describe('D-046: cancel and revert are one intent — both, or neither', () => {
    const advanced = [
      CandidateStage.EvaluationCompletee,
      CandidateStage.Accepte,
      CandidateStage.Rejete,
      CandidateStage.PreselectionCvValidee,
      CandidateStage.CandidatureRecue,
    ];

    for (const stage of advanced) {
      it(`D-046: a candidate at "${stage}" refuses the whole cancellation`, async () => {
        candidate.currentStage = stage;

        const res = await cancel({ cancellationReason: 'Motif' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
        // The decisive assertion: the interview was NOT half-cancelled.
        expect(interview.status).toBe(InterviewStatus.Planifie);
        expect(interview.save).not.toHaveBeenCalled();
        expect(mockedAuditLog.create).not.toHaveBeenCalled();
      });
    }

    it('D-046: the stage gate is checked before the interview is written', async () => {
      candidate.currentStage = CandidateStage.Accepte;

      await cancel({ cancellationReason: 'Motif' });

      expect(interview.cancellationReason).toBeUndefined();
    });

    it('FR-34: a vanished candidate is a 404 and cancels nothing', async () => {
      mockedCandidate.findById.mockResolvedValue(null);

      const res = await cancel({ cancellationReason: 'Motif' });

      expect(res.status).toBe(404);
      expect(interview.save).not.toHaveBeenCalled();
    });
  });

  describe('rule 4 / D-046: TWO audit entries, both named by rule 4', () => {
    it('rule 4: the cancellation is audited against the Interview', async () => {
      await cancel({ cancellationReason: 'Motif' });

      expect(mockedAuditLog.create.mock.calls.map((c) => c[0])).toContainEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.EntretienAnnule,
        targetType: AuditTargetType.Interview,
        targetId: INTERVIEW_ID,
      });
    });

    it('rule 4: the stage reversion is audited against the Candidate', async () => {
      await cancel({ cancellationReason: 'Motif' });

      expect(mockedAuditLog.create.mock.calls.map((c) => c[0])).toContainEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.EtapeCandidatModifiee,
        targetType: AuditTargetType.Candidate,
        targetId: CANDIDATE_ID,
      });
    });

    it('D-046: exactly two entries — rule 4 names both facts separately', async () => {
      await cancel({ cancellationReason: 'Motif' });

      expect(mockedAuditLog.create).toHaveBeenCalledTimes(2);
      expect(auditActions()).toEqual([
        AuditAction.EntretienAnnule,
        AuditAction.EtapeCandidatModifiee,
      ]);
    });

    it('D-033: the audit entries never carry the cancellation motive', async () => {
      await cancel({ cancellationReason: 'Raison confidentielle' });

      expect(JSON.stringify(mockedAuditLog.create.mock.calls)).not.toContain(
        'Raison confidentielle',
      );
    });

    it('rule 4: a refused cancellation writes nothing', async () => {
      await cancel({});

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-5 / FR-34: Recruteur only', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app)
        .post(`/api/v1/interviews/${INTERVIEW_ID}/cancel`)
        .send({ cancellationReason: 'Motif' });

      expect(res.status).toBe(401);
      expect(interview.save).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur is 403', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app)
        .post(`/api/v1/interviews/${INTERVIEW_ID}/cancel`)
        .set('Cookie', adminCookie)
        .send({ cancellationReason: 'Motif' });

      expect(res.status).toBe(403);
      expect(interview.save).not.toHaveBeenCalled();
    });

    it('FR-5: a Responsable hiérarchique is 403 — FR-34 says "le recruteur"', async () => {
      const responsableCookie = await signInAs(responsable);

      const res = await request(app)
        .post(`/api/v1/interviews/${INTERVIEW_ID}/cancel`)
        .set('Cookie', responsableCookie)
        .send({ cancellationReason: 'Motif' });

      expect(res.status).toBe(403);
    });
  });

  describe('FR-40: cancellation notifies BOTH the recruiter and the interviewer', () => {
    it('FR-40: an interview IS concerned, so the assigned responsable is told', async () => {
      await cancel({ cancellationReason: 'Candidat indisponible' });

      const rows = notifiedRows();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => String(r.userId)).sort()).toEqual([OWNER_ID, INTERVIEWER_ID].sort());
      expect(rows.every((r) => r.type === NotificationType.ChangementEtape)).toBe(true);
    });

    it("FR-40: the message names the CANCELLATION, not just the new stage", async () => {
      // « revenu à Présélection CV validée » alone would not tell an
      // interviewer that the slot they were about to attend is gone.
      await cancel({ cancellationReason: 'Candidat indisponible' });

      const message = String(notifiedRows()[0].message);
      expect(message).toContain('annulé');
      expect(message).toContain('Jean Martin');
      expect(message).toContain(CandidateStage.PreselectionCvValidee);
      expect(message).not.toContain('Candidat indisponible');
    });

    it('D-055: the acting recruiter is dropped when they also own the position', async () => {
      mockedJobPosition.findById.mockResolvedValue({ createdBy: RECRUTEUR_ID });

      await cancel({ cancellationReason: 'Motif' });

      const rows = notifiedRows();
      expect(rows).toHaveLength(1);
      expect(String(rows[0].userId)).toBe(INTERVIEWER_ID);
    });

    it('D-054: a notification failure does not fail the cancellation', async () => {
      mockedNotification.insertMany.mockRejectedValue(new Error('mongo indisponible'));

      const res = await cancel({ cancellationReason: 'Motif' });

      expect(res.status).toBe(200);
      expect(interview.status).toBe(InterviewStatus.Annule);
      expect(candidate.currentStage).toBe(CandidateStage.PreselectionCvValidee);
      expect(auditActions()).toHaveLength(2);
    });

    it('FR-40: a REFUSED cancellation notifies nobody', async () => {
      const res = await cancel({});

      expect(res.status).toBe(400);
      expect(mockedNotification.insertMany).not.toHaveBeenCalled();
    });
  });
});

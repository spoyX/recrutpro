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
const mockedInterview = Interview as unknown as { exists: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };
const mockedNotification = Notification as unknown as { insertMany: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const DEPT_ID = new Types.ObjectId().toString();
const PIERRE_ID = new Types.ObjectId().toString();
const OWNER_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();

const notifiedRows = (): Array<Record<string, unknown>> => {
  expect(mockedNotification.insertMany).toHaveBeenCalledTimes(1);
  return mockedNotification.insertMany.mock.calls[0][0];
};

const base = { name: 'X', passwordHash, isActive: true, mustChangePassword: false, departmentId: DEPT_ID };
const pierre = { ...base, _id: PIERRE_ID, email: 'pierre@example.com', role: Role.ResponsableHierarchique };
const sofia = { ...base, _id: new Types.ObjectId().toString(), email: 'sofia@example.com', role: Role.ResponsableHierarchique };
const marie = { ...base, _id: new Types.ObjectId().toString(), email: 'marie@example.com', role: Role.Recruteur };

let candidate: {
  _id: string;
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: string;
  currentStage: CandidateStage;
  registeredBy: string;
  registeredAt: Date;
  decisionComment?: string;
  decidedAt?: Date;
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

const decideAs = async (who: Record<string, unknown>, body: Record<string, unknown>) => {
  const cookie = await signInAs(who);
  return request(app)
    .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
    .set('Cookie', cookie)
    .send(body);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  candidate = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    email: 'jean.martin@example.com',
    phone: '0612345678',
    jobPositionId: new Types.ObjectId().toString(),
    currentStage: CandidateStage.EvaluationCompletee,
    registeredBy: PIERRE_ID,
    registeredAt: new Date('2026-08-01T09:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedCandidate.findById.mockResolvedValue(candidate);
  mockedJobPosition.findById.mockResolvedValue({ department: DEPT_ID, createdBy: OWNER_ID });
  mockedNotification.insertMany.mockResolvedValue([]);
  mockedInterview.exists.mockResolvedValue({ _id: 'an-interview' });
  mockedAuditLog.create.mockResolvedValue({});
});

afterAll(async () => {
  await closeSessionStore();
});

describe('Final decision — FR-29, FR-39', () => {
  describe('FR-39: the decision', () => {
    it('FR-29: accepts a candidate with a comment', async () => {
      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: '  Excellent profil.  ',
      });

      expect(res.status).toBe(200);
      expect(candidate.currentStage).toBe(CandidateStage.Accepte);
      expect(candidate.decisionComment).toBe('Excellent profil.');
      expect(res.body.currentStage).toBe(CandidateStage.Accepte);
    });

    it('FR-29: rejects a candidate with a comment', async () => {
      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Rejete,
        decisionComment: 'Profil insuffisant.',
      });

      expect(res.status).toBe(200);
      expect(candidate.currentStage).toBe(CandidateStage.Rejete);
      expect(candidate.decisionComment).toBe('Profil insuffisant.');
    });

    it('D-051: the comment is mandatory for ACCEPTANCE too, not just rejection', async () => {
      // The reason rejectionReason could not be reused for this.
      const res = await decideAs(pierre, { targetStage: CandidateStage.Accepte });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DECISION_COMMENT_REQUIRED');
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-29: rejection without a comment is refused', async () => {
      const res = await decideAs(pierre, { targetStage: CandidateStage.Rejete });

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-29: a whitespace-only comment counts as absent', async () => {
      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: '   ',
      });

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('D-051: the decision does NOT touch rejectionReason', async () => {
      await decideAs(pierre, {
        targetStage: CandidateStage.Rejete,
        decisionComment: 'Décision finale',
      });

      // The CV-stage motive is a different fact and must not be overwritten.
      expect(candidate).not.toHaveProperty('rejectionReason');
    });
  });

  describe('D-051: reachable only after « Évaluation complétée »', () => {
    const tooEarly = [
      CandidateStage.CandidatureRecue,
      CandidateStage.PreselectionCvValidee,
      CandidateStage.RejeteCv,
      CandidateStage.EntretienPlanifie,
    ];

    for (const stage of tooEarly) {
      it(`D-051: a candidate at "${stage}" cannot be decided`, async () => {
        candidate.currentStage = stage;

        const res = await decideAs(pierre, {
          targetStage: CandidateStage.Accepte,
          decisionComment: 'Trop tôt',
        });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
        expect(candidate.currentStage).toBe(stage);
        expect(candidate.save).not.toHaveBeenCalled();
      });
    }

    for (const stage of [CandidateStage.Accepte, CandidateStage.Rejete]) {
      it(`D-051: a candidate already at "${stage}" cannot be re-decided`, async () => {
        candidate.currentStage = stage;
        candidate.decisionComment = 'Décision initiale';

        const res = await decideAs(pierre, {
          targetStage: CandidateStage.Accepte,
          decisionComment: 'Changement d’avis',
        });

        expect(res.status).toBe(409);
        // Terminal means terminal — the original comment survives.
        expect(candidate.decisionComment).toBe('Décision initiale');
        expect(candidate.save).not.toHaveBeenCalled();
      });
    }
  });

  describe('D-051: only the ASSIGNED Responsable may decide', () => {
    it('FR-39: the assigned Responsable is accepted', async () => {
      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      expect(res.status).toBe(200);
    });

    it('D-047: a Responsable who never interviewed them is refused', async () => {
      mockedInterview.exists.mockResolvedValue(null);

      const res = await decideAs(sofia, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      expect(res.status).toBe(403);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('D-047: a Responsable outside the department is refused', async () => {
      mockedJobPosition.findById.mockResolvedValue({
        department: new Types.ObjectId().toString(),
      });

      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      expect(res.status).toBe(403);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('D-051: the Recruteur cannot take the final decision', async () => {
      const res = await decideAs(marie, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      // Not a stage a Recruteur may target — refused before any lookup.
      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app)
        .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
        .send({ targetStage: CandidateStage.Accepte, decisionComment: 'OK' });

      expect(res.status).toBe(401);
    });
  });

  describe('D-006 / D-051: still not a generic stage setter', () => {
    for (const stage of [
      CandidateStage.CandidatureRecue,
      CandidateStage.PreselectionCvValidee,
      CandidateStage.RejeteCv,
      CandidateStage.EntretienPlanifie,
      CandidateStage.EvaluationCompletee,
    ]) {
      it(`D-051: a Responsable cannot target "${stage}"`, async () => {
        const res = await decideAs(pierre, {
          targetStage: stage,
          decisionComment: 'peu importe',
        });

        expect(res.status).toBe(400);
        expect(candidate.save).not.toHaveBeenCalled();
      });
    }

    it('D-051: an unknown stage string is refused', async () => {
      const res = await decideAs(pierre, {
        targetStage: 'Embauché sur le champ',
        decisionComment: 'x',
      });

      expect(res.status).toBe(400);
    });

    it('FR-39: an unknown candidate is a 404', async () => {
      mockedCandidate.findById.mockResolvedValue(null);

      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('rule 4: the decision is audited', () => {
    it('rule 4: an EtapeCandidatModifiee entry names the deciding Responsable', async () => {
      await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'OK',
      });

      expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
      expect(mockedAuditLog.create.mock.calls[0][0]).toEqual({
        userId: PIERRE_ID,
        action: AuditAction.EtapeCandidatModifiee,
        targetType: AuditTargetType.Candidate,
        targetId: CANDIDATE_ID,
      });
    });

    it('D-033: the audit entry never carries the decision comment', async () => {
      await decideAs(pierre, {
        targetStage: CandidateStage.Rejete,
        decisionComment: 'Motif confidentiel',
      });

      expect(JSON.stringify(mockedAuditLog.create.mock.calls)).not.toContain(
        'Motif confidentiel',
      );
    });

    it('rule 4: a refused decision writes nothing', async () => {
      await decideAs(pierre, { targetStage: CandidateStage.Accepte });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('D-058: decidedAt, the time-to-hire end date', () => {
    it('D-058: stamped on ACCEPTANCE', async () => {
      const before = Date.now();

      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'Excellent profil.',
      });

      expect(res.status).toBe(200);
      expect(candidate.decidedAt).toBeInstanceOf(Date);
      expect(candidate.decidedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(res.body.decidedAt).toBe(candidate.decidedAt!.toISOString());
    });

    it('D-058: stamped on REJECTION too, so null means exactly "not yet decided"', async () => {
      await decideAs(pierre, {
        targetStage: CandidateStage.Rejete,
        decisionComment: 'Profil insuffisant.',
      });

      // Stamping only acceptances would make a null decidedAt ambiguous
      // between "undecided" and "decided negatively".
      expect(candidate.decidedAt).toBeInstanceOf(Date);
    });

    it('D-058: null before any decision is taken', async () => {
      candidate.currentStage = CandidateStage.EntretienPlanifie;

      const res = await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'Trop tôt',
      });

      expect(res.status).toBe(409);
      expect(candidate.decidedAt).toBeUndefined();
    });

    it('D-018 rule reused: a client-supplied decidedAt is ignored', async () => {
      const forged = new Date('2000-01-01T00:00:00.000Z');

      await decideAs(pierre, {
        targetStage: CandidateStage.Accepte,
        decisionComment: 'Excellent profil.',
        decidedAt: forged,
      });

      // A forged end date would falsify the time-to-hire report at will.
      expect(candidate.decidedAt!.getTime()).not.toBe(forged.getTime());
      expect(candidate.decidedAt!.getTime()).toBeGreaterThan(forged.getTime());
    });

    it('D-058: a REFUSED decision stamps nothing', async () => {
      const res = await decideAs(pierre, { targetStage: CandidateStage.Accepte });

      expect(res.status).toBe(400);
      expect(candidate.decidedAt).toBeUndefined();
    });
  });

  describe('FR-40: the final decision notifies the recruiter', () => {
    const decision = {
      targetStage: CandidateStage.Accepte,
      decisionComment: 'Excellent profil.',
    };

    it('FR-40: the responsible recruiter learns the outcome', async () => {
      await decideAs(pierre, decision);

      const rows = notifiedRows();
      expect(rows).toHaveLength(1);
      expect(String(rows[0].userId)).toBe(OWNER_ID);
      expect(rows[0].type).toBe(NotificationType.ChangementEtape);
      expect(rows[0].message).toContain(CandidateStage.Accepte);
    });

    it('D-055: the deciding responsable is not notified of their own decision', async () => {
      await decideAs(pierre, decision);

      expect(notifiedRows().filter((r) => String(r.userId) === PIERRE_ID)).toHaveLength(0);
    });

    it('D-033/D-055: the decision COMMENT is never put in the notification', async () => {
      await decideAs(pierre, decision);

      expect(String(notifiedRows()[0].message)).not.toContain('Excellent profil.');
    });

    it('D-054: a notification failure does not fail the decision', async () => {
      mockedNotification.insertMany.mockRejectedValue(new Error('mongo indisponible'));

      const res = await decideAs(pierre, decision);

      expect(res.status).toBe(200);
      expect(candidate.currentStage).toBe(CandidateStage.Accepte);
      expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('FR-40: a refused decision notifies nobody', async () => {
      const res = await decideAs(pierre, { targetStage: CandidateStage.Accepte });

      expect(res.status).toBe(400);
      expect(mockedNotification.insertMany).not.toHaveBeenCalled();
    });
  });
});

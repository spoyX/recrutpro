import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Role, CandidateStage, AuditAction, AuditTargetType } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const RECRUTEUR_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();

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

let candidate: {
  _id: string;
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: string;
  currentStage: CandidateStage;
  registeredBy: string;
  registeredAt: Date;
  rejectionReason?: string;
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

  candidate = {
    _id: CANDIDATE_ID,
    fullName: 'Jean Martin',
    email: 'jean.martin@example.com',
    phone: '0612345678',
    jobPositionId: new Types.ObjectId().toString(),
    currentStage: CandidateStage.CandidatureRecue,
    registeredBy: RECRUTEUR_ID,
    registeredAt: new Date('2026-08-05T10:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedCandidate.findById.mockResolvedValue(candidate);
  mockedAuditLog.create.mockResolvedValue({});

  cookie = await signInAs(recruteur);
});

afterAll(async () => {
  await closeSessionStore();
});

const review = (body: Record<string, unknown>) =>
  request(app).patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`).set('Cookie', cookie).send(body);

describe('CV review transition — FR-25, FR-26', () => {
  describe('FR-25: the pass transition', () => {
    it('FR-25: moves a candidate to "Présélection CV validée"', async () => {
      const res = await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(200);
      expect(candidate.currentStage).toBe(CandidateStage.PreselectionCvValidee);
      expect(candidate.save).toHaveBeenCalled();
      expect(res.body.currentStage).toBe(CandidateStage.PreselectionCvValidee);
    });

    it('FR-25: a pass records no rejection reason', async () => {
      await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(candidate.rejectionReason).toBeUndefined();
    });

    it('FR-26 / D-042: a reason supplied with a PASS is refused, not dropped', async () => {
      // Storing a rejection motive on a candidate who passed would put a false
      // statement in the record.
      const res = await review({
        targetStage: CandidateStage.PreselectionCvValidee,
        rejectionReason: 'CV trop court',
      });

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });
  });

  describe('FR-26: rejection requires a motive', () => {
    it('FR-25: moves a candidate to "Rejeté (CV)" with a reason', async () => {
      const res = await review({
        targetStage: CandidateStage.RejeteCv,
        rejectionReason: '  Profil hors périmètre technique.  ',
      });

      expect(res.status).toBe(200);
      expect(candidate.currentStage).toBe(CandidateStage.RejeteCv);
      expect(candidate.rejectionReason).toBe('Profil hors périmètre technique.');
      expect(res.body.rejectionReason).toBe('Profil hors périmètre technique.');
    });

    it('FR-26: rejecting WITHOUT a reason is a 400', async () => {
      const res = await review({ targetStage: CandidateStage.RejeteCv });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REJECTION_REASON_REQUIRED');
      // The decisive part: the stage did not move.
      expect(candidate.currentStage).toBe(CandidateStage.CandidatureRecue);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-26: a blank reason counts as no reason', async () => {
      const res = await review({ targetStage: CandidateStage.RejeteCv, rejectionReason: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REJECTION_REASON_REQUIRED');
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-26: a non-string reason is rejected', async () => {
      const res = await review({ targetStage: CandidateStage.RejeteCv, rejectionReason: 42 });

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });
  });

  describe('D-006 / D-042: this is NOT a generic stage setter', () => {
    const refusedStages = [
      CandidateStage.EntretienPlanifie,
      CandidateStage.EvaluationCompletee,
      CandidateStage.Accepte,
      CandidateStage.Rejete,
      CandidateStage.CandidatureRecue,
    ];

    for (const stage of refusedStages) {
      it(`D-006: cannot set stage to "${stage}" through this route`, async () => {
        const res = await review({ targetStage: stage });

        expect(res.status).toBe(400);
        expect(candidate.currentStage).toBe(CandidateStage.CandidatureRecue);
        expect(candidate.save).not.toHaveBeenCalled();
      });
    }

    it('D-006: an unknown stage string is refused', async () => {
      const res = await review({ targetStage: 'Embauché sur le champ' });

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('D-006: a missing targetStage is refused', async () => {
      const res = await review({});

      expect(res.status).toBe(400);
      expect(candidate.save).not.toHaveBeenCalled();
    });
  });

  describe('D-042: the transition is stage-gated and one-way', () => {
    const alreadyPast = [
      CandidateStage.PreselectionCvValidee,
      CandidateStage.RejeteCv,
      CandidateStage.EntretienPlanifie,
      CandidateStage.EvaluationCompletee,
      CandidateStage.Accepte,
      CandidateStage.Rejete,
    ];

    for (const stage of alreadyPast) {
      it(`D-042: a candidate at "${stage}" cannot be CV-reviewed again`, async () => {
        candidate.currentStage = stage;

        const res = await review({ targetStage: CandidateStage.PreselectionCvValidee });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
        expect(candidate.currentStage).toBe(stage);
        expect(candidate.save).not.toHaveBeenCalled();
      });
    }

    it('D-042: an already-rejected candidate cannot be flipped to validated', async () => {
      // The one that matters most: a rejection must not be quietly undone.
      candidate.currentStage = CandidateStage.RejeteCv;
      candidate.rejectionReason = 'Motif initial';

      const res = await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(409);
      expect(candidate.rejectionReason).toBe('Motif initial');
    });

    it('FR-25: an unknown candidate is a 404', async () => {
      mockedCandidate.findById.mockResolvedValue(null);

      const res = await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(404);
    });

    it('FR-25: a malformed id is a 404, not a cast error', async () => {
      const res = await request(app)
        .patch('/api/v1/candidates/not-an-id/stage')
        .set('Cookie', cookie)
        .send({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(404);
    });
  });

  describe('rule 4: the stage change is audited', () => {
    it('rule 4: a pass writes an audit entry against the acting recruiter', async () => {
      await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
      expect(mockedAuditLog.create.mock.calls[0][0]).toEqual({
        userId: RECRUTEUR_ID,
        action: AuditAction.EtapeCandidatModifiee,
        targetType: AuditTargetType.Candidate,
        targetId: CANDIDATE_ID,
      });
    });

    it('rule 4: a rejection is audited too', async () => {
      await review({ targetStage: CandidateStage.RejeteCv, rejectionReason: 'Motif' });

      expect(mockedAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('D-033: the audit entry never carries the rejection motive', async () => {
      await review({ targetStage: CandidateStage.RejeteCv, rejectionReason: 'Secret interne' });

      expect(JSON.stringify(mockedAuditLog.create.mock.calls[0][0])).not.toContain('Secret interne');
    });

    it('rule 4: a REFUSED transition writes no audit entry', async () => {
      candidate.currentStage = CandidateStage.Accepte;

      await review({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });

    it('rule 4: a rejection missing its motive writes no audit entry', async () => {
      await review({ targetStage: CandidateStage.RejeteCv });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-5 / D-042: Recruteur only', () => {
    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app)
        .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
        .send({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(401);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur is 403', async () => {
      const adminCookie = await signInAs(admin);

      const res = await request(app)
        .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
        .set('Cookie', adminCookie)
        .send({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(403);
      expect(candidate.save).not.toHaveBeenCalled();
    });

    it('FR-5: a Responsable hiérarchique is 403 — FR-25 says "le recruteur"', async () => {
      const responsableCookie = await signInAs(responsable);

      const res = await request(app)
        .patch(`/api/v1/candidates/${CANDIDATE_ID}/stage`)
        .set('Cookie', responsableCookie)
        .send({ targetStage: CandidateStage.PreselectionCvValidee });

      expect(res.status).toBe(403);
    });
  });
});

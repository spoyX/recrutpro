import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Candidate } from '../src/models/Candidate.model';
import { Interview } from '../src/models/Interview.model';
import { InterviewEvaluation } from '../src/models/InterviewEvaluation.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { AuditLog } from '../src/models/AuditLog.model';
import {
  Role,
  CandidateStage,
  InterviewStatus,
  AuditAction,
  AuditTargetType,
} from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Candidate.model');
jest.mock('../src/models/Interview.model');
jest.mock('../src/models/InterviewEvaluation.model');
jest.mock('../src/models/JobPosition.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedCandidate = Candidate as unknown as { findById: jest.Mock };
const mockedInterview = Interview as unknown as { findById: jest.Mock; exists: jest.Mock };
const mockedEvaluation = InterviewEvaluation as unknown as { findOne: jest.Mock; create: jest.Mock };
const mockedJobPosition = JobPosition as unknown as { findById: jest.Mock };
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const DEPT_ID = new Types.ObjectId().toString();
const PIERRE_ID = new Types.ObjectId().toString();
const SOFIA_ID = new Types.ObjectId().toString();
const CANDIDATE_ID = new Types.ObjectId().toString();
const INTERVIEW_ID = new Types.ObjectId().toString();
const EVALUATION_ID = new Types.ObjectId().toString();

const base = {
  name: 'X',
  passwordHash,
  isActive: true,
  mustChangePassword: false,
  departmentId: DEPT_ID,
};
/** The ASSIGNED responsable. */
const pierre = { ...base, _id: PIERRE_ID, email: 'pierre@example.com', role: Role.ResponsableHierarchique };
/** A responsable in the same department who is NOT assigned. */
const sofia = { ...base, _id: SOFIA_ID, email: 'sofia@example.com', role: Role.ResponsableHierarchique };
const marie = { ...base, _id: new Types.ObjectId().toString(), email: 'marie@example.com', role: Role.Recruteur };
const admin = { ...base, _id: new Types.ObjectId().toString(), email: 'admin@example.com', role: Role.Administrateur, departmentId: undefined };

const VALID_SCORES = { technicalSkills: 4, communication: 5, overallFit: 3 };

let candidate: {
  _id: string;
  jobPositionId: string;
  currentStage: CandidateStage;
  save: jest.Mock;
};
let interview: {
  _id: string;
  candidateId: string;
  interviewerId: string;
  scheduledAt: Date;
  status: InterviewStatus;
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

const submitAs = async (who: Record<string, unknown>, body: Record<string, unknown>) => {
  const cookie = await signInAs(who);
  return request(app)
    .post(`/api/v1/interviews/${INTERVIEW_ID}/evaluation`)
    .set('Cookie', cookie)
    .send(body);
};

beforeEach(() => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();

  interview = {
    _id: INTERVIEW_ID,
    candidateId: CANDIDATE_ID,
    interviewerId: PIERRE_ID,
    // Yesterday: the slot has passed.
    scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: InterviewStatus.Planifie,
    save: jest.fn().mockResolvedValue(undefined),
  };

  mockedInterview.findById.mockResolvedValue(interview);
  mockedInterview.exists.mockResolvedValue({ _id: INTERVIEW_ID });
  candidate = {
    _id: CANDIDATE_ID,
    jobPositionId: new Types.ObjectId().toString(),
    currentStage: CandidateStage.EntretienPlanifie,
    save: jest.fn().mockResolvedValue(undefined),
  };
  mockedCandidate.findById.mockResolvedValue(candidate);
  mockedJobPosition.findById.mockResolvedValue({ department: DEPT_ID });
  mockedEvaluation.findOne.mockResolvedValue(null);
  mockedEvaluation.create.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: EVALUATION_ID,
    ...doc,
  }));
  mockedAuditLog.create.mockResolvedValue({});
});

afterAll(async () => {
  await closeSessionStore();
});

describe('Evaluation submission — FR-36, FR-37', () => {
  describe('FR-36: the happy path', () => {
    it('FR-36: the assigned Responsable submits scores and comments', async () => {
      const res = await submitAs(pierre, { scores: VALID_SCORES, comments: '  Bon profil.  ' });

      expect(res.status).toBe(201);
      expect(res.body.scores).toEqual(VALID_SCORES);
      expect(res.body.comments).toBe('Bon profil.');
      expect(res.body.submittedBy).toBe(PIERRE_ID);
    });

    it('FR-36: comments are optional', async () => {
      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(201);
      expect(res.body.comments).toBeNull();
    });

    it('D-048: submitting marks the interview "Réalisé"', async () => {
      // Nothing else in the system ever assigns this status.
      await submitAs(pierre, { scores: VALID_SCORES });

      expect(interview.status).toBe(InterviewStatus.Realise);
      expect(interview.save).toHaveBeenCalled();
    });

    it('D-016: the evaluation is stored against the interview', async () => {
      await submitAs(pierre, { scores: VALID_SCORES });

      expect(mockedEvaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({ interviewId: INTERVIEW_ID, submittedBy: PIERRE_ID }),
      );
    });
  });

  describe('FR-37: incomplete or invalid forms are blocked', () => {
    for (const missing of ['technicalSkills', 'communication', 'overallFit']) {
      it(`FR-37: a form missing "${missing}" is refused`, async () => {
        const scores: Record<string, number> = { ...VALID_SCORES };
        delete scores[missing];

        const res = await submitAs(pierre, { scores });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('MISSING_REQUIRED_SCORES');
        expect(res.body.error.message).toContain(missing);
        // Nothing written, and the interview is untouched.
        expect(mockedEvaluation.create).not.toHaveBeenCalled();
        expect(interview.status).toBe(InterviewStatus.Planifie);
      });
    }

    it('FR-37: an entirely missing scores object is refused', async () => {
      const res = await submitAs(pierre, {});

      expect(res.status).toBe(400);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    for (const [label, value] of [
      ['below the scale', 0],
      ['above the scale', 6],
      ['negative', -3],
    ] as const) {
      it(`FR-36: a score ${label} is refused`, async () => {
        const res = await submitAs(pierre, {
          scores: { ...VALID_SCORES, communication: value },
        });

        expect(res.status).toBe(400);
        expect(mockedEvaluation.create).not.toHaveBeenCalled();
      });
    }

    it('D-048: a fractional score is refused — it is a five-POINT scale', async () => {
      // The schema's min/max alone would have accepted this.
      const res = await submitAs(pierre, { scores: { ...VALID_SCORES, overallFit: 3.5 } });

      expect(res.status).toBe(400);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('D-048: a numeric STRING is refused', async () => {
      const res = await submitAs(pierre, { scores: { ...VALID_SCORES, technicalSkills: '4' } });

      expect(res.status).toBe(400);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('FR-36: non-string comments are refused', async () => {
      const res = await submitAs(pierre, { scores: VALID_SCORES, comments: 42 });

      expect(res.status).toBe(400);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });
  });

  describe('D-048: who may submit — compared across principals, not by shape', () => {
    it('FR-36: the ASSIGNED Responsable is accepted', async () => {
      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(201);
    });

    it('D-048: a DIFFERENT Responsable in the same department is refused', async () => {
      // Same role, same department — only the assignment separates them.
      mockedInterview.exists.mockResolvedValue(null);

      const res = await submitAs(sofia, { scores: VALID_SCORES });

      expect(res.status).toBe(403);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
      expect(interview.status).toBe(InterviewStatus.Planifie);
    });

    it('D-048: a Responsable assigned to ANOTHER interview with the same candidate is still refused for THIS one', async () => {
      // hasAssignedInterviewWith passes, but this interview is not theirs.
      mockedInterview.exists.mockResolvedValue({ _id: 'some-other-interview' });

      const res = await submitAs(sofia, { scores: VALID_SCORES });

      expect(res.status).toBe(403);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('D-047: a Responsable outside the department is refused', async () => {
      mockedJobPosition.findById.mockResolvedValue({
        department: new Types.ObjectId().toString(),
      });

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(403);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('FR-36: the Recruteur cannot evaluate — they schedule and cancel', async () => {
      const res = await submitAs(marie, { scores: VALID_SCORES });

      expect(res.status).toBe(403);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('FR-5: an Administrateur cannot evaluate', async () => {
      const res = await submitAs(admin, { scores: VALID_SCORES });

      expect(res.status).toBe(403);
    });

    it('FR-5: an unauthenticated request is rejected', async () => {
      const res = await request(app)
        .post(`/api/v1/interviews/${INTERVIEW_ID}/evaluation`)
        .send({ scores: VALID_SCORES });

      expect(res.status).toBe(401);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });
  });

  describe('D-048: the interview must be in a state that accepts an evaluation', () => {
    it('D-048: a CANCELLED interview cannot be evaluated', async () => {
      interview.status = InterviewStatus.Annule;

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INTERVIEW_CANCELLED');
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('D-048: an already-evaluated interview is refused', async () => {
      interview.status = InterviewStatus.Realise;

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EVALUATION_ALREADY_SUBMITTED');
    });

    it('D-016: a second evaluation for the same interview is refused', async () => {
      mockedEvaluation.findOne.mockResolvedValue({ _id: 'existing' });

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(409);
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('FR-36 / D-048: an interview that has NOT happened yet cannot be evaluated', async () => {
      interview.scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INTERVIEW_NOT_HELD_YET');
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
    });

    it('FR-36: an unknown interview is a 404', async () => {
      mockedInterview.findById.mockResolvedValue(null);

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(404);
    });

    it('FR-36: a malformed id is a 404, not a cast error', async () => {
      const cookie = await signInAs(pierre);

      const res = await request(app)
        .post('/api/v1/interviews/not-an-id/evaluation')
        .set('Cookie', cookie)
        .send({ scores: VALID_SCORES });

      expect(res.status).toBe(404);
    });
  });

  describe('rule 4: evaluation submission is audited', () => {
    it('rule 4: an audit entry names the submitting Responsable', async () => {
      await submitAs(pierre, { scores: VALID_SCORES });

      // Two entries since FR-38 landed — the submission and the stage change.
      // The pairing itself is asserted in the FR-38 block below.
      expect(mockedAuditLog.create.mock.calls[0][0]).toEqual({
        userId: PIERRE_ID,
        action: AuditAction.EvaluationSoumise,
        targetType: AuditTargetType.InterviewEvaluation,
        targetId: EVALUATION_ID,
      });
    });

    it('D-033: the audit entry never carries the scores or comments', async () => {
      await submitAs(pierre, { scores: VALID_SCORES, comments: 'Commentaire confidentiel' });

      expect(JSON.stringify(mockedAuditLog.create.mock.calls)).not.toContain(
        'Commentaire confidentiel',
      );
    });

    it('rule 4: a refused submission writes no audit entry', async () => {
      await submitAs(pierre, { scores: { technicalSkills: 4 } });

      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('FR-28 / FR-38: the stage transition (was the pinned D-048 gap)', () => {
    it('FR-38: the candidate moves to "Évaluation complétée"', async () => {
      await submitAs(pierre, { scores: VALID_SCORES });

      expect(candidate.currentStage).toBe(CandidateStage.EvaluationCompletee);
      expect(candidate.save).toHaveBeenCalled();
    });

    it('FR-38: interview AND candidate both move in the SAME request', async () => {
      await submitAs(pierre, { scores: VALID_SCORES });

      expect(interview.status).toBe(InterviewStatus.Realise);
      expect(candidate.currentStage).toBe(CandidateStage.EvaluationCompletee);
    });

    it('rule 4: the stage change is audited alongside the submission', async () => {
      await submitAs(pierre, { scores: VALID_SCORES });

      const entries = mockedAuditLog.create.mock.calls.map((c) => c[0]);
      expect(entries).toContainEqual({
        userId: PIERRE_ID,
        action: AuditAction.EvaluationSoumise,
        targetType: AuditTargetType.InterviewEvaluation,
        targetId: EVALUATION_ID,
      });
      expect(entries).toContainEqual({
        userId: PIERRE_ID,
        action: AuditAction.EtapeCandidatModifiee,
        targetType: AuditTargetType.Candidate,
        targetId: CANDIDATE_ID,
      });
      expect(mockedAuditLog.create).toHaveBeenCalledTimes(2);
    });

    it('D-050: a candidate in the wrong stage refuses the WHOLE submission', async () => {
      // D-046's rule reused: gates before writes, so no evaluation is stored
      // against a candidate who never moved.
      candidate.currentStage = CandidateStage.EvaluationCompletee;

      const res = await submitAs(pierre, { scores: VALID_SCORES });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
      expect(mockedEvaluation.create).not.toHaveBeenCalled();
      expect(interview.status).toBe(InterviewStatus.Planifie);
      expect(candidate.save).not.toHaveBeenCalled();
      expect(mockedAuditLog.create).not.toHaveBeenCalled();
    });

    it('D-050: a rejected form leaves the candidate stage untouched', async () => {
      await submitAs(pierre, { scores: { technicalSkills: 4 } });

      expect(candidate.currentStage).toBe(CandidateStage.EntretienPlanifie);
      expect(candidate.save).not.toHaveBeenCalled();
    });
  });
});

import { Types, Error as MongooseError } from 'mongoose';
import { User } from '../src/models/User.model';
import { Department } from '../src/models/Department.model';
import { JobPosition } from '../src/models/JobPosition.model';
import { Candidate } from '../src/models/Candidate.model';
import { Resume } from '../src/models/Resume.model';
import { Interview } from '../src/models/Interview.model';
import { InterviewEvaluation } from '../src/models/InterviewEvaluation.model';
import { Notification } from '../src/models/Notification.model';
import { AuditLog } from '../src/models/AuditLog.model';
import {
  Role,
  CandidateStage,
  JobPositionStatus,
  InterviewStatus,
  NotificationType,
  AuditAction,
  AuditTargetType,
} from '../src/common/constants';

// No database connection needed: validate() runs the schema rules in-process.
// Returns the ValidationError, or undefined when the document is valid.
const validationError = (doc: {
  validate: () => Promise<void>;
}): Promise<MongooseError.ValidationError | undefined> =>
  doc.validate().then(
    () => undefined,
    (err: MongooseError.ValidationError) => err,
  );

const oid = () => new Types.ObjectId();

describe('Mongoose schemas — ARCHITECTURE.md Section 7', () => {
  it('registers all 9 entities', () => {
    const models = [
      User,
      Department,
      JobPosition,
      Candidate,
      Resume,
      Interview,
      InterviewEvaluation,
      Notification,
      AuditLog,
    ];
    expect(models).toHaveLength(9);
    expect(models.map((m) => m.modelName)).toEqual([
      'User',
      'Department',
      'JobPosition',
      'Candidate',
      'Resume',
      'Interview',
      'InterviewEvaluation',
      'Notification',
      'AuditLog',
    ]);
  });

  it('FR-6: a Recruteur without a department is rejected (department scoping, rule 2)', async () => {
    const err = await validationError(
      new User({
        name: 'Marie Dupont',
        email: 'marie@example.com',
        passwordHash: 'x',
        role: Role.Recruteur,
      }),
    );
    expect(err?.errors.departmentId).toBeDefined();
  });

  it('FR-6: an Administrateur needs no department', async () => {
    const err = await validationError(
      new User({
        name: 'Admin',
        email: 'admin@example.com',
        passwordHash: 'x',
        role: Role.Administrateur,
      }),
    );
    expect(err).toBeUndefined();
  });

  it('FR-3 / NFR-05: a malformed email is rejected', async () => {
    const err = await validationError(
      new User({
        name: 'Bad Email',
        email: 'not-an-email',
        passwordHash: 'x',
        role: Role.Administrateur,
      }),
    );
    expect(err?.errors.email).toBeDefined();
  });

  it('rule 3: passwordHash is never selected by default', () => {
    expect(User.schema.path('passwordHash').options.select).toBe(false);
  });

  it('FR-19: a new candidate starts at "Candidature reçue"', async () => {
    const candidate = new Candidate({
      fullName: 'Jean Martin',
      email: 'jean@example.com',
      phone: '0600000000',
      jobPositionId: oid(),
      registeredBy: oid(),
    });
    expect(candidate.currentStage).toBe(CandidateStage.CandidatureRecue);
    expect(await validationError(candidate)).toBeUndefined();
  });

  it('FR-24 / D-018: registeredAt is stamped server-side on creation', async () => {
    const before = Date.now();
    const candidate = new Candidate({
      fullName: 'Jean Martin',
      email: 'jean@example.com',
      phone: '0600000000',
      jobPositionId: oid(),
      registeredBy: oid(),
    });
    expect(await validationError(candidate)).toBeUndefined();
    expect(candidate.registeredAt).toBeInstanceOf(Date);
    expect(candidate.registeredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(candidate.registeredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('FR-24 / D-018: a client-supplied registeredAt is overwritten, not trusted', async () => {
    const forged = new Date('2000-01-01T00:00:00.000Z');
    const candidate = new Candidate({
      fullName: 'Jean Martin',
      email: 'jean@example.com',
      phone: '0600000000',
      jobPositionId: oid(),
      registeredBy: oid(),
      registeredAt: forged,
    });
    expect(await validationError(candidate)).toBeUndefined();
    expect(candidate.registeredAt.getTime()).not.toBe(forged.getTime());
    expect(candidate.registeredAt.getTime()).toBeGreaterThan(forged.getTime());
  });

  it('FR-24 / D-018: registeredAt is immutable once the candidate exists', () => {
    expect(Candidate.schema.path('registeredAt').options.immutable).toBe(true);
  });

  it('ARCHITECTURE.md Section 8: currentStage accepts only the fixed stages', async () => {
    const err = await validationError(
      new Candidate({
        fullName: 'Jean Martin',
        email: 'jean@example.com',
        phone: '0600000000',
        jobPositionId: oid(),
        registeredBy: oid(),
        currentStage: 'Entretien réalisé',
      }),
    );
    expect(err?.errors.currentStage).toBeDefined();
  });

  it('FR-20 / D-004: candidate email is NOT uniquely indexed, so a confirmed duplicate is possible', () => {
    expect(Candidate.schema.path('email').options.unique).toBeFalsy();
    const compound = Candidate.schema
      .indexes()
      .find(([fields]) => 'email' in fields && 'jobPositionId' in fields);
    expect(compound).toBeDefined();
    expect(compound?.[1]?.unique).toBeFalsy();
  });

  it('FR-14: a job position defaults to Brouillon', async () => {
    const job = new JobPosition({
      title: 'Développeur',
      department: oid(),
      description: 'Poste backend',
    });
    expect(job.status).toBe(JobPositionStatus.Brouillon);
    expect(await validationError(job)).toBeUndefined();
  });

  it('FR-15: createdAt is immutable', () => {
    expect(JobPosition.schema.path('createdAt').options.immutable).toBe(true);
  });

  it('FR-34: cancelling an interview requires a reason', async () => {
    const err = await validationError(
      new Interview({
        candidateId: oid(),
        interviewerId: oid(),
        scheduledAt: new Date(),
        status: InterviewStatus.Annule,
      }),
    );
    expect(err?.errors.cancellationReason).toBeDefined();
  });

  it('FR-30: a scheduled interview needs no cancellation reason', async () => {
    const err = await validationError(
      new Interview({
        candidateId: oid(),
        interviewerId: oid(),
        scheduledAt: new Date(),
      }),
    );
    expect(err).toBeUndefined();
  });

  it('FR-37: an evaluation missing a mandatory score is blocked', async () => {
    const err = await validationError(
      new InterviewEvaluation({
        interviewId: oid(),
        scores: { technicalSkills: 4, communication: 3 },
        submittedBy: oid(),
      }),
    );
    expect(err?.errors['scores.overallFit']).toBeDefined();
  });

  it('FR-36: scores outside the 1-5 scale are rejected', async () => {
    const err = await validationError(
      new InterviewEvaluation({
        interviewId: oid(),
        scores: { technicalSkills: 6, communication: 0, overallFit: 3 },
        submittedBy: oid(),
      }),
    );
    expect(err?.errors['scores.technicalSkills']).toBeDefined();
    expect(err?.errors['scores.communication']).toBeDefined();
  });

  it('FR-36: a complete evaluation passes without comments', async () => {
    const err = await validationError(
      new InterviewEvaluation({
        interviewId: oid(),
        scores: { technicalSkills: 4, communication: 5, overallFit: 3 },
        submittedBy: oid(),
      }),
    );
    expect(err).toBeUndefined();
  });

  it('FR-43 / FR-44: notifications start unread and carry no TTL expiry', async () => {
    const notification = new Notification({
      userId: oid(),
      type: NotificationType.EvaluationSoumise,
      message: 'Une évaluation a été soumise.',
    });
    expect(notification.isRead).toBe(false);
    expect(await validationError(notification)).toBeUndefined();
    const hasTtl = Notification.schema
      .indexes()
      .some(([, options]) => options && 'expireAfterSeconds' in options);
    expect(hasTtl).toBe(false);
  });

  it('FR-13: a department defaults to active', async () => {
    const department = new Department({ name: 'Ingénierie' });
    expect(department.isActive).toBe(true);
    expect(await validationError(department)).toBeUndefined();
  });

  it('FR-22: a resume defaults to active', async () => {
    // D-040: publicId is required — it is the Cloudinary handle needed to
    // delete the old asset on replacement and to sign a delivery URL.
    const resume = new Resume({
      candidateId: oid(),
      fileUrl: 'https://res.cloudinary.com/demo/raw/authenticated/s--x--/recrutpro/resumes/abc.pdf',
      publicId: 'recrutpro/resumes/abc.pdf',
    });
    expect(resume.isActive).toBe(true);
    expect(await validationError(resume)).toBeUndefined();
  });

  it('FR-22 / D-040: a resume without a publicId is invalid', async () => {
    // Without it, a replaced CV could only ever be orphaned in Cloudinary.
    const resume = new Resume({ candidateId: oid(), fileUrl: 'https://res.cloudinary.com/x' });
    expect(await validationError(resume)).toBeDefined();
  });

  it('FR-11 / rule 4: audit entries are valid and immutable', async () => {
    const entry = new AuditLog({
      userId: oid(),
      action: AuditAction.MotDePasseReinitialise,
      targetType: AuditTargetType.User,
      targetId: oid(),
    });
    expect(await validationError(entry)).toBeUndefined();
    for (const field of ['userId', 'action', 'targetType', 'targetId', 'timestamp']) {
      expect(AuditLog.schema.path(field).options.immutable).toBe(true);
    }
  });
});

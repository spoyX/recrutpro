import { Types } from 'mongoose';
import { Interview, IInterview } from '../models/Interview.model';
import { Candidate } from '../models/Candidate.model';
import {
  InterviewEvaluation,
  IInterviewEvaluation,
  IEvaluationScores,
} from '../models/InterviewEvaluation.model';
import { IUser } from '../models/User.model';
import { InterviewStatus, Role, AuditAction, AuditTargetType } from '../common/constants';
import { AppError } from '../common/errors';
import { recordAudit } from '../common/audit';
import { hasAssignedInterviewWith } from './interview.service';

/** FR-36 — the three criteria SRS.md itself names (D-016). */
export const EVALUATION_CRITERIA = ['technicalSkills', 'communication', 'overallFit'] as const;
export type EvaluationCriterion = (typeof EVALUATION_CRITERIA)[number];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

export interface SubmitEvaluationInput {
  scores: Partial<Record<EvaluationCriterion, unknown>>;
  comments?: string;
}

/**
 * FR-37 — submission is blocked unless every mandatory score is present and
 * on the scale.
 *
 * Integer-checked, not just range-checked: the schema's min/max would accept
 * 3.5, but « une échelle de 1 à 5 » is a five-point scale (D-048).
 */
const parseScores = (raw: Partial<Record<EvaluationCriterion, unknown>>): IEvaluationScores => {
  const parsed = {} as IEvaluationScores;
  const missing: EvaluationCriterion[] = [];

  for (const criterion of EVALUATION_CRITERIA) {
    const value = raw?.[criterion];

    if (value === undefined || value === null || value === '') {
      missing.push(criterion);
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `La note « ${criterion} » doit être un entier de ${SCORE_MIN} à ${SCORE_MAX}.`,
      );
    }
    if (value < SCORE_MIN || value > SCORE_MAX) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `La note « ${criterion} » doit être comprise entre ${SCORE_MIN} et ${SCORE_MAX}.`,
      );
    }
    parsed[criterion] = value;
  }

  if (missing.length > 0) {
    throw new AppError(
      400,
      'MISSING_REQUIRED_SCORES',
      `Toutes les notes sont obligatoires. Manquant : ${missing.join(', ')}. ` +
        `Complétez le formulaire avant de le soumettre.`,
    );
  }

  return parsed;
};

/**
 * FR-36 / FR-37 — submit the evaluation for an interview.
 *
 * D-048: only the ASSIGNED Responsable hiérarchique, using the very same
 * predicate as the FR-35 list and the CV route, so "interviews I can see",
 * "CVs I can read" and "interviews I can evaluate" are one set rather than
 * three that have to be kept in step.
 */
export const submitEvaluation = async (
  interviewId: string,
  input: SubmitEvaluationInput,
  viewer: IUser,
): Promise<{ evaluation: IInterviewEvaluation; interview: IInterview }> => {
  if (!Types.ObjectId.isValid(interviewId)) {
    throw new AppError(404, 'NOT_FOUND', "Cet entretien n'existe pas.");
  }

  const interview = await Interview.findById(interviewId);
  if (!interview) {
    throw new AppError(404, 'NOT_FOUND', "Cet entretien n'existe pas.");
  }

  // FR-36 / UC-11: the Recruteur schedules and cancels; they do not evaluate.
  if (viewer.role !== Role.ResponsableHierarchique) {
    throw new AppError(
      403,
      'FORBIDDEN',
      "Seul le responsable hiérarchique assigné à cet entretien peut soumettre une évaluation.",
    );
  }

  const candidate = await Candidate.findById(interview.candidateId);
  if (!candidate) {
    throw new AppError(404, 'NOT_FOUND', "Le candidat de cet entretien n'existe plus.");
  }

  // D-047's predicate, reused verbatim: assigned to me AND in my department.
  if (!(await hasAssignedInterviewWith(viewer, candidate))) {
    throw new AppError(
      403,
      'FORBIDDEN',
      "Vous ne pouvez évaluer que les entretiens qui vous sont assignés.",
    );
  }
  // hasAssignedInterviewWith answers "any interview with this candidate";
  // this route is about THIS interview, so pin it too.
  if (String(interview.interviewerId) !== String(viewer._id)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      "Vous ne pouvez évaluer que les entretiens qui vous sont assignés.",
    );
  }

  if (interview.status === InterviewStatus.Annule) {
    throw new AppError(
      409,
      'INTERVIEW_CANCELLED',
      "Cet entretien a été annulé : il ne peut pas être évalué.",
    );
  }
  if (interview.status === InterviewStatus.Realise) {
    throw new AppError(
      409,
      'EVALUATION_ALREADY_SUBMITTED',
      'Une évaluation a déjà été soumise pour cet entretien.',
    );
  }

  // FR-36: « APRÈS un entretien » (D-048).
  if (interview.scheduledAt.getTime() > Date.now()) {
    throw new AppError(
      409,
      'INTERVIEW_NOT_HELD_YET',
      "Cet entretien n'a pas encore eu lieu. L'évaluation ne peut être soumise qu'après l'entretien.",
    );
  }

  // Validated BEFORE anything is written, so a rejected form leaves no trace.
  const scores = parseScores(input.scores ?? {});
  const comments = typeof input.comments === 'string' ? input.comments.trim() : undefined;

  // The unique index on interviewId is the real guarantee; this is the
  // friendly error for the ordinary case (D-016).
  const existing = await InterviewEvaluation.findOne({ interviewId: interview._id });
  if (existing) {
    throw new AppError(
      409,
      'EVALUATION_ALREADY_SUBMITTED',
      'Une évaluation a déjà été soumise pour cet entretien.',
    );
  }

  const evaluation = await InterviewEvaluation.create({
    interviewId: interview._id,
    scores,
    comments: comments || undefined,
    submittedBy: viewer._id,
  });

  // D-048: submitting the evaluation is what marks the interview as held.
  // Nothing else in the system ever assigns Réalisé.
  interview.status = InterviewStatus.Realise;
  await interview.save();

  // FR-11 / rule 4 — "evaluation submission" is named explicitly in rule 4,
  // so no extension of the rule is needed here (unlike D-044's scheduling).
  await recordAudit({
    userId: String(viewer._id),
    action: AuditAction.EvaluationSoumise,
    targetType: AuditTargetType.InterviewEvaluation,
    targetId: evaluation._id as Types.ObjectId,
  });

  // TODO(FR-38): move the candidate to « Évaluation complétée » (FR-28) and
  // notify the recruiter (FR-41). Deliberately NOT wired here — TASKS.md
  // separates it as its own step. Until it lands, an evaluated candidate
  // stays at « Entretien planifié ». See D-048.

  return { evaluation, interview };
};

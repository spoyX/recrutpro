import { Role, CandidateStage, InterviewStatus } from '../common/constants';
import { DashboardData } from '../services/dashboard.service';
import { PublicAuditLog, toPublicAuditLog } from './auditLog.view';

/**
 * The "V" of MVC (D-003): the JSON shape each role's dashboard takes on the
 * way out.
 *
 * These are deliberately SLIMMER than the candidate and interview list rows,
 * rather than reusing `toCandidateListItem` / `toInterviewListItem`:
 *
 *  - A dashboard widget needs a name and a stage, not a candidate's email and
 *    phone. FR-45 asks for « les dernières activités », not a contact list, and
 *    putting personal data on a summary screen that no FR asks for is data
 *    nobody requested.
 *  - `hasResume` would cost an extra query per widget and is not part of FR-45
 *    or FR-46. Claiming `false` without checking would be worse than omitting
 *    it, so it is omitted.
 */

export interface DashboardCandidateRow {
  id: string;
  fullName: string;
  currentStage: CandidateStage;
  registeredAt: string;
  jobPosition: { id: string; title: string } | null;
}

export interface DashboardInterviewRow {
  id: string;
  scheduledAt: string;
  status: InterviewStatus;
  candidate: { id: string; fullName: string } | null;
  jobPosition: { id: string; title: string } | null;
}

/**
 * FR-47's audit rows are the SAME shape `GET /audit-logs` (UC-04) returns —
 * shared rather than redeclared, so the dashboard and the audit view can never
 * drift into showing the same entry differently.
 */
export type DashboardAuditRow = PublicAuditLog;

export type PublicDashboard =
  | {
      role: Role.Recruteur;
      openPositions: number;
      candidatesByStage: Record<string, number>;
      recentCandidates: DashboardCandidateRow[];
    }
  | {
      role: Role.ResponsableHierarchique;
      departmentCandidatesInProgress: number;
      candidatesByStage: Record<string, number>;
      upcomingInterviews: DashboardInterviewRow[];
      pendingEvaluations: number;
      /** D-088 — FR-39's worklist. Same shape as the recent-candidate row. */
      candidatesAwaitingDecision: DashboardCandidateRow[];
    }
  | {
      role: Role.Administrateur;
      activeUsers: number;
      recentAuditEntries: DashboardAuditRow[];
    };

/** A populated ref, or a bare ObjectId when the populate found nothing. */
type Ref = { _id?: unknown; title?: string; name?: string; fullName?: string } | null | undefined;

const asPosition = (ref: Ref): { id: string; title: string } | null =>
  ref && typeof ref === 'object' && 'title' in ref
    ? { id: String(ref._id), title: String(ref.title) }
    : null;

export const toPublicDashboard = (data: DashboardData): PublicDashboard => {
  if (data.role === Role.Recruteur) {
    return {
      role: Role.Recruteur,
      openPositions: data.openPositions,
      candidatesByStage: data.candidatesByStage,
      // Null-tolerant throughout: one odd row must not break the whole widget.
      recentCandidates: data.recentCandidates.map((candidate) => ({
        id: String(candidate._id),
        fullName: candidate.fullName,
        currentStage: candidate.currentStage,
        registeredAt: candidate.registeredAt.toISOString(),
        jobPosition: asPosition(candidate.jobPositionId as Ref),
      })),
    };
  }

  if (data.role === Role.ResponsableHierarchique) {
    return {
      role: Role.ResponsableHierarchique,
      departmentCandidatesInProgress: data.departmentCandidatesInProgress,
      candidatesByStage: data.candidatesByStage,
      pendingEvaluations: data.pendingEvaluations,
      // D-088 — deliberately the SAME row shape as FR-45's recent candidates,
      // shared rather than redeclared, so the two lists cannot drift into
      // showing the same candidate differently. It carries no contact details:
      // FR-35 withholds those from this role (D-067) and a dashboard must not
      // be the one place they leak.
      candidatesAwaitingDecision: data.candidatesAwaitingDecision.map((candidate) => ({
        id: String(candidate._id),
        fullName: candidate.fullName,
        currentStage: candidate.currentStage,
        registeredAt: candidate.registeredAt.toISOString(),
        jobPosition: asPosition(candidate.jobPositionId as Ref),
      })),
      upcomingInterviews: data.upcomingInterviews.map((interview) => {
        const candidate = interview.candidateId as Ref;
        return {
          id: String(interview._id),
          scheduledAt: interview.scheduledAt.toISOString(),
          status: interview.status,
          candidate:
            candidate && typeof candidate === 'object' && 'fullName' in candidate
              ? { id: String(candidate._id), fullName: String(candidate.fullName) }
              : null,
          jobPosition: asPosition(
            (candidate as { jobPositionId?: Ref } | null)?.jobPositionId,
          ),
        };
      }),
    };
  }

  return {
    role: Role.Administrateur,
    activeUsers: data.activeUsers,
    recentAuditEntries: data.recentAuditEntries.map(toPublicAuditLog),
  };
};

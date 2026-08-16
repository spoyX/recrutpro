import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Mirrors the backend's `PublicDashboard` union (views/dashboard.view.ts).
 *
 * The `role` field is the discriminant, and it is decided SERVER-side from the
 * session (D-057) — the client never asks for a particular role's dashboard,
 * it renders whichever shape arrives.
 */
export interface DashboardCandidateRow {
  id: string;
  fullName: string;
  currentStage: string;
  registeredAt: string;
  jobPosition: { id: string; title: string } | null;
}

export interface DashboardInterviewRow {
  id: string;
  scheduledAt: string;
  status: string;
  candidate: { id: string; fullName: string } | null;
  jobPosition: { id: string; title: string } | null;
}

export interface DashboardAuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
  user: { id: string; name: string } | null;
}

export type Dashboard =
  | {
      role: 'Recruteur';
      openPositions: number;
      candidatesByStage: Record<string, number>;
      recentCandidates: DashboardCandidateRow[];
    }
  | {
      role: 'ResponsableHierarchique';
      departmentCandidatesInProgress: number;
      candidatesByStage: Record<string, number>;
      upcomingInterviews: DashboardInterviewRow[];
      pendingEvaluations: number;
      /**
       * D-088 — the candidates this responsable owes a DECISION (FR-39).
       *
       * NOT a list version of `pendingEvaluations`, which counts something
       * else: interviews HELD but not yet evaluated. These are candidates
       * already at « Évaluation complétée », where the evaluation is in and
       * the decision is owed.
       */
      candidatesAwaitingDecision: DashboardCandidateRow[];
    }
  | {
      role: 'Administrateur';
      activeUsers: number;
      recentAuditEntries: DashboardAuditRow[];
    };

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  /** FR-45 / FR-46 / FR-47 — one endpoint, three shapes (D-057). */
  getDashboard(): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${environment.apiUrl}/dashboard`, {
      // Session auth (D-001): the cookie is the credential.
      withCredentials: true,
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * D-091 — how a user appears when named inside someone else's payload.
 * Mirrors the backend's `NamedUserRef`; `avatarUrl` is a proxy path or null.
 */
export interface NamedUserRef {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Mirrors the backend's `InterviewListItem` (views/interview.view.ts).
 *
 * D-045 claimed this row "returns everything a calendar needs"; checked against
 * the view before building, and it does — the candidate's name, the poste
 * title, the responsable's name and the slot, plus FR-35's CV access.
 *
 * `resumeUrl` is this API's own proxy route (D-040), never a storage URL.
 */
export interface InterviewListItem {
  id: string;
  scheduledAt: string;
  status: string;
  candidate: { id: string; fullName: string; hasResume: boolean; resumeUrl: string } | null;
  jobPosition: { id: string; title: string } | null;
  interviewer: NamedUserRef | null;
  cancellationReason: string | null;
}

/** FR-33's filters, plus D-041/D-045's pagination and sorting. */
export interface InterviewListQuery {
  interviewerId?: string;
  jobPositionId?: string;
  fromDate?: string;
  toDate?: string;
  /** D-049 — NOT `includeCancelled`; the old name was removed, not aliased. */
  includeFinished?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'scheduledAt' | 'status';
  sortDir?: 'asc' | 'desc';
}

export interface InterviewPage {
  items: InterviewListItem[];
  total: number;
}

export const INTERVIEW_PAGE_SIZE = 25;

/**
 * D-073 — one row of FR-30's interviewer picker, mirroring the backend's
 * `InterviewerOption`. Deliberately NOT the full account shape: `GET /users`
 * returns only `{id, name, departmentId}` to a Recruteur.
 */
export interface InterviewerOption {
  id: string;
  name: string;
  departmentId: string | null;
}

/**
 * FR-36 — the three criteria SRS.md itself names, mirroring the backend's
 * `EVALUATION_CRITERIA`. The ORDER here is the render order of the form.
 */
export const EVALUATION_CRITERIA = [
  { key: 'technicalSkills', label: 'Compétences techniques' },
  { key: 'communication', label: 'Communication' },
  { key: 'overallFit', label: 'Adéquation globale' },
] as const;

export type EvaluationCriterion = (typeof EVALUATION_CRITERIA)[number]['key'];

/** FR-36 — « une échelle de 1 à 5 », a five-point scale (D-048). */
export const SCORE_SCALE = [1, 2, 3, 4, 5] as const;

export interface SubmitEvaluationInput {
  scores: Record<EvaluationCriterion, number>;
  comments?: string;
}

/** FR-30 to FR-32 — the scheduling request body. */
export interface ScheduleInterviewInput {
  candidateId: string;
  interviewerId: string;
  /** ISO 8601 instant. The form collects a LOCAL time and converts. */
  scheduledAt: string;
  /** FR-32 — the recruiter's explicit "book it anyway" after a conflict warning. */
  confirmDespiteConflict?: boolean;
}

@Injectable({ providedIn: 'root' })
export class InterviewService {
  private readonly http = inject(HttpClient);

  /**
   * FR-33 (Recruteur, unscoped) and FR-35 (Responsable, scoped to their own
   * assignments) — ONE route, the scope decided server-side (D-047).
   *
   * A schedule reads FORWARD by default, unlike the newest-first candidate
   * list (D-045). Only parameters actually set are sent: the server refuses an
   * unknown value with a 400 rather than ignoring it.
   */
  listInterviews(query: InterviewListQuery = {}): Observable<InterviewPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http
      .get<InterviewListItem[]>(`${environment.apiUrl}/interviews`, {
        params,
        withCredentials: true,
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          items: response.body ?? [],
          total: Number(response.headers.get('X-Total-Count') ?? response.body?.length ?? 0),
        })),
      );
  }

  /**
   * FR-34 — cancel a planned interview. Recruteur-only server-side.
   *
   * The motive is mandatory and enforced in the SERVICE (D-046), so a blank one
   * comes back as a specific 400 rather than a generic validation error.
   * Cancelling also reverts the candidate to « Présélection CV validée », and
   * the server refuses the WHOLE operation if it cannot (409) — so a failure
   * here never leaves a half-cancelled interview.
   */
  cancelInterview(id: string, cancellationReason: string): Observable<unknown> {
    return this.http.post(
      `${environment.apiUrl}/interviews/${encodeURIComponent(id)}/cancel`,
      { cancellationReason },
      { withCredentials: true },
    );
  }

  /**
   * FR-30's picker — D-073's carve-out on `GET /users`.
   *
   * `role=ResponsableHierarchique` is MANDATORY server-side, not a convenience:
   * this is the only shape of the request a Recruteur may make, and anything
   * else is a 403. `departmentId` is what keeps the list to the eligible
   * responsables, since FR-30 requires the interviewer to belong to the
   * department of the poste — but it is the SERVER that enforces that at
   * scheduling time (D-030: a constrained picker is not an enforced rule).
   */
  listInterviewers(departmentId?: string): Observable<InterviewerOption[]> {
    let params = new HttpParams().set('role', 'ResponsableHierarchique');
    if (departmentId) {
      params = params.set('departmentId', departmentId);
    }

    return this.http
      .get<InterviewerOption[]>(`${environment.apiUrl}/users`, {
        params,
        withCredentials: true,
      })
      .pipe(map((users) => users ?? []));
  }

  /**
   * FR-30 to FR-32 — schedule an interview.
   *
   * A conflict (FR-31) comes back as a 409 `SCHEDULING_CONFLICT`, which is a
   * WARNING with an override rather than a refusal: the caller re-sends with
   * `confirmDespiteConflict` to book it anyway (FR-32).
   */
  scheduleInterview(input: ScheduleInterviewInput): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${environment.apiUrl}/interviews`, input, {
      withCredentials: true,
    });
  }

  /**
   * FR-36 / FR-37 — submit the evaluation for one interview.
   *
   * Scores go as NUMBERS: the service integer-checks them (D-048), so a string
   * from a form control would be refused as "not an integer" and the message
   * would blame the value rather than the type.
   *
   * `comments` is omitted when empty rather than sent as `''` — FR-36 makes the
   * comment field optional, and an empty string is a value, not an absence.
   */
  submitEvaluation(id: string, input: SubmitEvaluationInput): Observable<unknown> {
    return this.http.post(
      `${environment.apiUrl}/interviews/${encodeURIComponent(id)}/evaluation`,
      {
        scores: input.scores,
        ...(input.comments ? { comments: input.comments } : {}),
      },
      { withCredentials: true },
    );
  }
}

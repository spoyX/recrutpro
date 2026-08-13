import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

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
  interviewer: { id: string; name: string } | null;
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
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Mirrors the backend's `CandidateDetail` (views/candidate.view.ts, D-067).
 *
 * `email` and `phone` are NULLABLE by design, not by accident: FR-35 grants a
 * Responsable hiérarchique the candidate's name, poste and CV — not their
 * contact details — so the server returns null for that role. The template
 * must handle it rather than assume a string.
 */
export interface CandidateDetailEvaluation {
  id: string;
  scores: { technicalSkills: number; communication: number; overallFit: number };
  comments: string | null;
  submittedBy: { id: string; name: string } | null;
}

export interface CandidateDetailInterview {
  id: string;
  scheduledAt: string;
  status: string;
  interviewer: { id: string; name: string } | null;
  cancellationReason: string | null;
  evaluation: CandidateDetailEvaluation | null;
}

export interface CandidateDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobPosition: { id: string; title: string } | null;
  currentStage: string;
  registeredBy: { id: string; name: string } | null;
  registeredAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  decisionComment: string | null;
  /** D-040: `url` is this API's own proxy route, never a storage URL. */
  resume: { hasResume: boolean; url: string | null };
  interviews: CandidateDetailInterview[];
}

/** Mirrors the backend's `CandidateListItem` (FR-24, D-041). */
export interface CandidateListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  jobPosition: { id: string; title: string } | null;
  currentStage: string;
  registeredAt: string;
  hasResume: boolean;
}

/** FR-24's filters, plus D-041's pagination and sorting. */
export interface CandidateListQuery {
  jobPositionId?: string;
  currentStage?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'fullName' | 'currentStage' | 'registeredAt';
  sortDir?: 'asc' | 'desc';
}

/**
 * D-041 keeps the body a bare array and puts the match count in a header, so a
 * page needs both halves to paginate.
 */
export interface CandidatePage {
  items: CandidateListItem[];
  total: number;
}

/** The only sortable columns the server accepts — anything else is a 400. */
export const CANDIDATE_SORT_FIELDS = ['fullName', 'currentStage', 'registeredAt'] as const;

/** ARCHITECTURE.md Section 8's fixed pipeline, for the stage filter. */
export const CANDIDATE_STAGES = [
  'Candidature reçue',
  'Présélection CV validée',
  'Rejeté (CV)',
  'Entretien planifié',
  'Évaluation complétée',
  'Accepté',
  'Rejeté',
] as const;

export const CANDIDATE_PAGE_SIZE = 25;

@Injectable({ providedIn: 'root' })
export class CandidateService {
  private readonly http = inject(HttpClient);

  /** The whole candidate file in one request (D-067). */
  getCandidate(id: string): Observable<CandidateDetail> {
    return this.http.get<CandidateDetail>(
      `${environment.apiUrl}/candidates/${encodeURIComponent(id)}`,
      // Session auth (D-001): the cookie is the credential.
      { withCredentials: true },
    );
  }

  /**
   * FR-24 — the filtered, paginated candidate list.
   *
   * Reads the response through `observe: 'response'` because the match count
   * lives in `X-Total-Count`, not the body (D-041). Only parameters that are
   * actually set are sent: an empty `currentStage=` is an unknown filter value
   * and the server refuses it with a 400 rather than ignoring it, which is the
   * behaviour that makes a bad filter visible instead of silently empty.
   */
  listCandidates(query: CandidateListQuery = {}): Observable<CandidatePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http
      .get<CandidateListItem[]>(`${environment.apiUrl}/candidates`, {
        params,
        withCredentials: true,
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          items: response.body ?? [],
          // Falls back to the page length only if the header is missing, which
          // would mean a proxy stripped it — better a usable page than NaN.
          total: Number(response.headers.get('X-Total-Count') ?? response.body?.length ?? 0),
        })),
      );
  }
}

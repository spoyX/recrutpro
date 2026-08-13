import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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
}

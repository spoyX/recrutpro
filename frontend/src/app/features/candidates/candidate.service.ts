import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpEvent, HttpEventType } from '@angular/common/http';
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
  submittedBy: NamedUserRef | null;
}

export interface CandidateDetailInterview {
  id: string;
  scheduledAt: string;
  status: string;
  interviewer: NamedUserRef | null;
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
  registeredBy: NamedUserRef | null;
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

/**
 * FR-29 / FR-39 — the two terminal outcomes a Responsable hiérarchique may set.
 *
 * These are `targetStage` values on the SHARED stage route, not a decision
 * endpoint of their own: `PATCH /candidates/:id/stage` executes the ONE
 * transition the caller owns, chosen by their role (D-051). The Recruteur's
 * « Présélection CV validée » / « Rejeté (CV) » travel the same route and are
 * refused for this role, and vice versa — which is why there is no
 * `/decision` endpoint to add.
 */
export const FINAL_DECISION_STAGES = ['Accepté', 'Rejeté'] as const;
export type FinalDecisionStage = (typeof FINAL_DECISION_STAGES)[number];

/**
 * FR-25 / FR-26 — the two outcomes of the Recruteur's CV preselection.
 *
 * The SAME `PATCH /candidates/:id/stage` route as the final decision, which
 * executes the one transition the caller's role owns (D-042, D-051). These two
 * values are refused for a Responsable, and `FINAL_DECISION_STAGES` are refused
 * for a Recruteur — the role picks which pair is legal, never the client.
 */
export const CV_REVIEW_STAGES = ['Présélection CV validée', 'Rejeté (CV)'] as const;
export type CvReviewStage = (typeof CV_REVIEW_STAGES)[number];

/** FR-19 — what the registration form sends. `currentStage` is NOT among them. */
export interface RegisterCandidateInput {
  fullName: string;
  email: string;
  phone: string;
  jobPositionId: string;
  /** FR-20 / D-004 — the recruiter's explicit "yes, register it anyway". */
  confirmDuplicate?: boolean;
}

/** The subset of `PublicCandidate` the registration flow needs back. */
export interface RegisteredCandidate {
  id: string;
  fullName: string;
  currentStage: string;
}

/**
 * D-040 — what comes back from an upload. `downloadUrl` is this API's own
 * proxy route; there is no `fileUrl` and no `publicId`, by construction in the
 * server's view. Nothing here is ever assembled client-side.
 */
export interface UploadedResume {
  id: string;
  candidateId: string;
  uploadedAt: string;
  isActive: boolean;
  downloadUrl: string;
}

/** Progress for the FR-21 upload, or the finished resume. */
export type ResumeUploadEvent =
  | { kind: 'progress'; percent: number | null }
  | { kind: 'done'; resume: UploadedResume };

/**
 * D-007 — the limits the SERVER enforces, restated here only to render them as
 * guidance. They are NOT a client-side gate: the real check is the magic-byte
 * signature test, which no browser API performs and which a renamed executable
 * would sail past.
 */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_ACCEPT = '.pdf,.docx';

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

  /**
   * FR-29 / FR-39 — the final decision.
   *
   * `decisionComment` is mandatory for BOTH outcomes, not only for a rejection
   * (D-051): a hire is a decision that needs a reason on the record just as
   * much as a refusal. The server enforces it and refuses a whitespace-only
   * comment, so this is a request the client cannot make valid on its own.
   *
   * The candidate must be at « Évaluation complétée » and the caller must be
   * the ASSIGNED responsable — both checked server-side through the same
   * predicate as the FR-35 list and the FR-36 evaluation (D-047, D-051).
   */
  decideOutcome(
    id: string,
    targetStage: FinalDecisionStage,
    decisionComment: string,
  ): Observable<unknown> {
    return this.http.patch(
      `${environment.apiUrl}/candidates/${encodeURIComponent(id)}/stage`,
      { targetStage, decisionComment },
      { withCredentials: true },
    );
  }

  /**
   * FR-25 / FR-26 — the CV preselection decision.
   *
   * **THE ASYMMETRY IS THE POINT, and it is the inverse of `decideOutcome`.**
   * `rejectionReason` is MANDATORY on « Rejeté (CV) » and **FORBIDDEN** on
   * « Présélection CV validée » — supplying one on a pass is a 400, not a
   * silently dropped field, because storing a rejection motive against a
   * candidate who was not rejected would put a false statement in the record
   * (D-042). Contrast `decideOutcome`, where the comment is required on BOTH
   * outcomes (D-051). The parameter is therefore only ever sent on a rejection.
   *
   * The transition is ONE-WAY and gated on « Candidature reçue » server-side.
   */
  reviewCv(id: string, targetStage: CvReviewStage, rejectionReason?: string): Observable<unknown> {
    return this.http.patch(
      `${environment.apiUrl}/candidates/${encodeURIComponent(id)}/stage`,
      {
        targetStage,
        ...(targetStage === 'Rejeté (CV)' ? { rejectionReason } : {}),
      },
      { withCredentials: true },
    );
  }

  /**
   * FR-19 / FR-20 — register a candidate.
   *
   * `currentStage` is deliberately NOT sent. FR-19 fixes the initial stage at
   * « Candidature reçue » and the server sets it; a client-supplied stage would
   * be a way to enter the pipeline part-way through (D-006).
   *
   * `confirmDuplicate` is omitted rather than sent as `false` on a first
   * attempt: the server treats only a literal `true` as confirmation, and
   * sending the flag at all on the first try misrepresents what the recruiter
   * has been shown.
   */
  registerCandidate(input: RegisterCandidateInput): Observable<RegisteredCandidate> {
    return this.http.post<RegisteredCandidate>(
      `${environment.apiUrl}/candidates`,
      {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        jobPositionId: input.jobPositionId,
        ...(input.confirmDuplicate ? { confirmDuplicate: true } : {}),
      },
      { withCredentials: true },
    );
  }

  /**
   * FR-21 / FR-22 — attach a CV.
   *
   * `multipart/form-data` with the field name `file`, which is what the
   * server's multer instance reads. The Content-Type header is deliberately
   * NOT set: the browser must add it itself, because only it knows the
   * multipart boundary — setting it by hand produces a body the server cannot
   * parse.
   *
   * Progress is reported so a 5 MB upload is not a frozen button. It is
   * presentation only: the file is accepted or refused by the server's
   * magic-byte check (D-007) long after the bar reaches 100%.
   */
  uploadResume(candidateId: string, file: File): Observable<ResumeUploadEvent> {
    const body = new FormData();
    body.append('file', file, file.name);

    return this.http
      .post<UploadedResume>(
        `${environment.apiUrl}/candidates/${encodeURIComponent(candidateId)}/resume`,
        body,
        { withCredentials: true, reportProgress: true, observe: 'events' },
      )
      .pipe(
        map((event: HttpEvent<UploadedResume>): ResumeUploadEvent => {
          if (event.type === HttpEventType.UploadProgress) {
            return {
              kind: 'progress',
              // `total` is absent when the size is unknown; a percentage
              // invented from a missing total would be a lie, so it stays null
              // and the bar renders indeterminate.
              percent: event.total ? Math.round((100 * event.loaded) / event.total) : null,
            };
          }
          if (event.type === HttpEventType.Response) {
            return { kind: 'done', resume: event.body as UploadedResume };
          }
          return { kind: 'progress', percent: null };
        }),
      );
  }
}

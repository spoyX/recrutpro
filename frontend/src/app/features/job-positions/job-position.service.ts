import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Mirrors the backend's `PublicJobPosition` (views/jobPosition.view.ts).
 * Only the fields a picker needs are declared; the endpoint returns more.
 */
export interface JobPositionOption {
  id: string;
  title: string;
  status: string;
}

/**
 * The full `PublicJobPosition`. Note what it does NOT carry: the department
 * NAME (only `departmentId`) and any candidate count. The details page
 * resolves the first from `GET /departments` and the second from
 * `GET /candidates?jobPositionId=…`, both existing endpoints.
 *
 * `createdBy` is deliberately absent from the API (D-052/D-055): it is
 * notification routing only and must never be rendered as an owner.
 */
export interface JobPosition {
  id: string;
  title: string;
  departmentId: string;
  description: string;
  requirements: string | null;
  status: string;
  createdAt: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
  /**
   * D-016/D-030: a position may only point at an ACTIVE department, and the
   * server refuses an inactive one. Carried here so the create form can offer
   * only assignable departments — while still being able to NAME a deactivated
   * one that an existing position already points at.
   */
  isActive: boolean;
}

/** FR-14/FR-15's status choices. « Clôturé » is NOT one of them (D-037). */
export const ASSIGNABLE_STATUSES = ['Brouillon', 'Ouvert'] as const;
export type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

/** FR-17's status filter — all three, including the one only FR-16 can set. */
export const JOB_POSITION_STATUSES = ['Brouillon', 'Ouvert', 'Clôturé'] as const;

export interface JobPositionInput {
  title: string;
  departmentId: string;
  description: string;
  requirements?: string;
  status?: AssignableStatus;
}

export interface JobPositionFilters {
  status?: string;
  departmentId?: string;
}

@Injectable({ providedIn: 'root' })
export class JobPositionService {
  private readonly http = inject(HttpClient);

  /**
   * FR-17 — every position, for FR-24's « filtrable par poste » picker.
   *
   * Deliberately UNFILTERED by status: a recruiter looking at the pipeline of a
   * `Clôturé` position is a normal thing to do (D-059 makes the same point
   * about the pipeline report — a zero on a closed poste reads differently
   * from a zero on an open one), so restricting the picker to `Ouvert` would
   * hide candidates that exist.
   */
  listOptions(): Observable<JobPositionOption[]> {
    // Structurally a narrower view of the SAME payload, so it delegates rather
    // than issuing its own differently-shaped GET.
    return this.listPositions();
  }

  /**
   * FR-17 — the management list, « filtrable par statut et département ».
   *
   * UNPAGINATED, matching the endpoint: `listJobPositions` returns every match
   * with no limit or offset. The page therefore renders no pager rather than
   * inventing one over a full result set.
   */
  listPositions(filters: JobPositionFilters = {}): Observable<JobPosition[]> {
    const params: Record<string, string> = {};
    if (filters.status) {
      params['status'] = filters.status;
    }
    if (filters.departmentId) {
      params['departmentId'] = filters.departmentId;
    }

    return this.http
      .get<JobPosition[]>(`${environment.apiUrl}/job-positions`, {
        params,
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(map((positions) => positions ?? []));
  }

  /** FR-17 — one position (D-038: Recruteur full, Administrateur read-only). */
  getJobPosition(id: string): Observable<JobPosition> {
    return this.http.get<JobPosition>(
      `${environment.apiUrl}/job-positions/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
  }

  /**
   * FR-13's department list, used here only to turn a `departmentId` into a
   * NAME. Open to any authenticated role (D-035), and returns active
   * departments by default — a position may reference a deactivated one, so
   * `includeInactive` is set or its name would render as "unknown" on exactly
   * the postings most likely to need explaining.
   */
  listDepartments(): Observable<DepartmentOption[]> {
    return this.http
      .get<DepartmentOption[]>(`${environment.apiUrl}/departments`, {
        params: { includeInactive: 'true' },
        withCredentials: true,
      })
      .pipe(map((departments) => departments ?? []));
  }

  /** FR-14 — create. Recruteur-only server-side (D-038). */
  createPosition(input: JobPositionInput): Observable<JobPosition> {
    return this.http.post<JobPosition>(`${environment.apiUrl}/job-positions`, input, {
      withCredentials: true,
    });
  }

  /**
   * FR-15 — edit. A PATCH carrying only what CHANGED, which is the verb's own
   * semantics and also the reason an untouched department is never revalidated:
   * a position pointing at a since-deactivated department stays editable in
   * every other field, instead of being held hostage by D-030 on a value the
   * recruiter never touched.
   */
  updatePosition(id: string, changes: Partial<JobPositionInput>): Observable<JobPosition> {
    return this.http.patch<JobPosition>(
      `${environment.apiUrl}/job-positions/${encodeURIComponent(id)}`,
      changes,
      { withCredentials: true },
    );
  }

  /**
   * FR-16 — close. Its OWN action, never a status assignment: the update route
   * refuses `status: 'Clôturé'` outright (D-037), because a terminal state is a
   * side effect of an action rather than a value a client may pick.
   *
   * There is deliberately no `deletePosition` — FR-18/D-038 ruled DELETE out
   * permanently, and closure is the only removal path.
   */
  closePosition(id: string): Observable<JobPosition> {
    return this.http.post<JobPosition>(
      `${environment.apiUrl}/job-positions/${encodeURIComponent(id)}/close`,
      {},
      { withCredentials: true },
    );
  }
}

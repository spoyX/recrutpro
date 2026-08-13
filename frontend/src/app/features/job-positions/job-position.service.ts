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
    return this.http
      .get<JobPositionOption[]>(`${environment.apiUrl}/job-positions`, {
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
}

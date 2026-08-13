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
}

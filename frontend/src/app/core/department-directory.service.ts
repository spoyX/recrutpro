import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * The one place `GET /departments` is called from, and the cache in front of it.
 *
 * NO NEW ENDPOINT — checked before building, not assumed. `PublicUser` already
 * carries `departmentId` (it always has), and `GET /departments` sits after
 * `router.use(requireAuth)` but BEFORE `router.use(requireRole(Administrateur))`
 * in department.routes.ts, so every authenticated role may read it. That is
 * D-035's ruling, and the route still enforces it.
 *
 * *** WHY A SHARED DIRECTORY RATHER THAN A SECOND CALLER. ***
 * The topbar needed a department NAME, and `JobPositionService` was already
 * fetching the same list for its filter. Adding a second caller would have
 * issued two identical requests on /job-positions and /job-position-details —
 * which is exactly what it did, and what the job-positions specs caught by
 * finding two matches where they expected one. Both now share this, so the
 * request happens once per session however many consumers ask.
 *
 * `includeInactive=true` on purpose. FR-13 wants a deactivated department gone
 * from CHOICE LISTS, and D-035 defaults the endpoint to active-only for exactly
 * that reason — but a name still has to be resolvable for a position or a user
 * already attached to one that was since deactivated. `isActive` is carried on
 * every row so a picker can still offer only assignable departments (D-030).
 *
 * NOT used by the administration screen, deliberately: that screen CREATES and
 * RENAMES departments, and a session-long cache would show it stale data
 * immediately after a write. `AdminService` keeps its own uncached call.
 */
export interface DepartmentOption {
  id: string;
  name: string;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class DepartmentDirectory {
  private readonly http = inject(HttpClient);

  private cache$?: Observable<DepartmentOption[]>;

  /**
   * The department list, fetched at most once per session.
   *
   * Errors PROPAGATE rather than being swallowed here: a caller that needs to
   * degrade says so itself, and the two do it differently — the job-positions
   * filter empties, while the topbar simply renders no department. The cache is
   * dropped on failure so the next subscriber retries instead of being handed a
   * permanently empty list.
   */
  list(): Observable<DepartmentOption[]> {
    this.cache$ ??= this.http
      .get<DepartmentOption[]>(`${environment.apiUrl}/departments`, {
        params: { includeInactive: 'true' },
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(
        map((rows) => rows ?? []),
        catchError((error: unknown) => {
          this.cache$ = undefined;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.cache$;
  }

  /** id → name, for naming the department something else already points at. */
  names(): Observable<ReadonlyMap<string, string>> {
    return this.list().pipe(map((rows) => new Map(rows.map((d) => [d.id, d.name]))));
  }
}

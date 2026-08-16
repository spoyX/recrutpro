import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * FR-6 to FR-13 — the administration module.
 *
 * Mirrors `views/user.view.ts` (`AdminUser`) and `views/department.view.ts`.
 * Note what is NOT here and never may be: `passwordHash`. ARCHITECTURE.md
 * rule 3 keeps it out of every response by construction, and the one password
 * this file ever sees is D-031's single-use temporary one.
 */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'Administrateur' | 'Recruteur' | 'ResponsableHierarchique';
  departmentId: string | null;
  /** D-084 — which of FR-8 / FR-9 this row may offer. */
  isActive: boolean;
  /** FR-10 — the account is sitting on an administrator-issued credential. */
  mustChangePassword: boolean;
  /**
   * D-091 — this API's own proxy path (`/api/v1/users/:id/avatar`), or null
   * when the account has no photo. NEVER a Cloudinary URL: storage URLs stay
   * server-side, exactly as for a CV.
   */
  avatarUrl: string | null;
}

export interface Department {
  id: string;
  name: string;
  isActive: boolean;
}

export const ROLES = ['Administrateur', 'Recruteur', 'ResponsableHierarchique'] as const;
export type Role = (typeof ROLES)[number];

/** D-016/D-030: only these two roles are department-scoped. */
export const ROLES_NEEDING_DEPARTMENT: readonly Role[] = ['Recruteur', 'ResponsableHierarchique'];

export interface UserFilters {
  role?: string;
  isActive?: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  departmentId?: string;
}

export type UpdateUserInput = Partial<Pick<CreateUserInput, 'name' | 'role' | 'departmentId'>>;

export interface PasswordReset {
  user: AdminUser;
  /**
   * D-031 — returned ONCE, to the administrator who asked. It is never stored
   * in clear and is not retrievable afterwards, so the UI that receives it is
   * the only place it will ever exist.
   */
  temporaryPassword: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly users = `${environment.apiUrl}/users`;
  private readonly departments = `${environment.apiUrl}/departments`;

  /**
   * FR-12 — the account directory, Administrateur-only.
   *
   * D-073 carved a narrow exception into this route for a Recruteur, but only
   * with `role=ResponsableHierarchique`; this caller is the administration
   * half and sends no such filter unless the admin picks one.
   */
  listUsers(filters: UserFilters = {}): Observable<AdminUser[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      // Only what is actually set: an empty `role=` is an unknown filter value
      // the server refuses with a 400, not the absence of a filter.
      if (value) {
        params = params.set(key, value);
      }
    }

    return this.http
      .get<AdminUser[]>(this.users, {
        params,
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(map((users) => users ?? []));
  }

  /** FR-6 — create an account. The password is sent once and never echoed. */
  createUser(input: CreateUserInput): Observable<AdminUser> {
    return this.http.post<AdminUser>(this.users, input, { withCredentials: true });
  }

  /** FR-7 — edit name, role or department. Never the password (FR-10 owns that). */
  updateUser(id: string, changes: UpdateUserInput): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.users}/${encodeURIComponent(id)}`, changes, {
      withCredentials: true,
    });
  }

  /**
   * FR-8 — revoke access. Not a delete: the account keeps its history, and
   * D-027's per-request reload means live sessions stop working immediately
   * rather than at expiry.
   */
  deactivateUser(id: string): Observable<AdminUser> {
    return this.http.patch<AdminUser>(
      `${this.users}/${encodeURIComponent(id)}/deactivate`,
      {},
      { withCredentials: true },
    );
  }

  /** FR-9 — restore access. */
  reactivateUser(id: string): Observable<AdminUser> {
    return this.http.patch<AdminUser>(
      `${this.users}/${encodeURIComponent(id)}/reactivate`,
      {},
      { withCredentials: true },
    );
  }

  /** FR-10 — issue a temporary password, returned once (D-031). */
  resetPassword(id: string): Observable<PasswordReset> {
    return this.http.post<PasswordReset>(
      `${this.users}/${encodeURIComponent(id)}/reset-password`,
      {},
      { withCredentials: true },
    );
  }

  /**
   * FR-13 — every department, deactivated ones included.
   *
   * `includeInactive` is deliberate here and wrong everywhere else: the pickers
   * elsewhere must NOT offer a deactivated department (the server refuses one,
   * D-030), but the screen that manages them has to show what it manages.
   */
  listDepartments(includeInactive = true): Observable<Department[]> {
    return this.http
      .get<Department[]>(this.departments, {
        params: includeInactive ? { includeInactive: 'true' } : {},
        withCredentials: true,
      })
      .pipe(map((departments) => departments ?? []));
  }

  /** FR-13 — create. Names are unique (D-016); a clash is a 409. */
  createDepartment(name: string): Observable<Department> {
    return this.http.post<Department>(this.departments, { name }, { withCredentials: true });
  }

  /** FR-13 — rename. */
  renameDepartment(id: string, name: string): Observable<Department> {
    return this.http.patch<Department>(
      `${this.departments}/${encodeURIComponent(id)}`,
      { name },
      { withCredentials: true },
    );
  }

  /**
   * FR-13 — deactivate. Its own action, not a rename with a flag, and the
   * reason a deactivated department still has to be listed somewhere: existing
   * job positions and users keep pointing at it.
   */
  deactivateDepartment(id: string): Observable<Department> {
    return this.http.patch<Department>(
      `${this.departments}/${encodeURIComponent(id)}/deactivate`,
      {},
      { withCredentials: true },
    );
  }

  /** FR-13 — reactivate. */
  reactivateDepartment(id: string): Observable<Department> {
    return this.http.patch<Department>(
      `${this.departments}/${encodeURIComponent(id)}/reactivate`,
      {},
      { withCredentials: true },
    );
  }
}

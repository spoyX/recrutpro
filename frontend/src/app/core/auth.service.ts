import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

/** The public user shape the API returns (backend views/user.view.ts). */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: 'Administrateur' | 'Recruteur' | 'ResponsableHierarchique';
  departmentId: string | null;
  mustChangePassword: boolean;
}

/** ARCHITECTURE.md Section 9 fixes one error shape for the whole API. */
export interface ApiError {
  error: { code: string; message: string };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /**
   * The signed-in user, or null. A signal so components read it without
   * subscribing; this is the v20 idiom and avoids an async pipe per template.
   */
  readonly currentUser = signal<AuthenticatedUser | null>(null);

  /**
   * FR-1 — sign in.
   *
   * `withCredentials` is REQUIRED and is the whole reason this works: auth is
   * SESSION-based, not JWT (D-001), so the browser must send and store the
   * `recrutpro.sid` cookie. Without it every subsequent request would be
   * anonymous and the login would appear to succeed while authenticating
   * nobody. There is no token to put in a header.
   */
  login(email: string, password: string): Observable<AuthenticatedUser> {
    return this.http
      .post<AuthenticatedUser>(
        `${environment.apiUrl}/auth/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  /** FR-4 — sign out. Idempotent server-side (D-026), so no error handling here. */
  logout(): Observable<void> {
    return this.http
      .post<void>(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(tap(() => this.currentUser.set(null)));
  }
}

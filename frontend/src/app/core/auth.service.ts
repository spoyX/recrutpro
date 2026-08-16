import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, catchError } from 'rxjs';
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

  /**
   * Rehydrate `currentUser` from the session cookie (D-070, closes D-065).
   *
   * `login()` is the only other writer, and its response arrives exactly once
   * — so before this existed a browser refresh left the app signed in on the
   * server while the client believed nobody was there: a blank topbar, and
   * role-gated navigation hidden from users entitled to it.
   *
   * A 401 is the NORMAL anonymous answer, not an error: it resolves to null so
   * the app boots for signed-out visitors too. It never rejects, because it
   * runs during bootstrap and a rejection would fail the whole app.
   */
  restoreSession(): Observable<AuthenticatedUser | null> {
    return this.http
      .get<AuthenticatedUser>(`${environment.apiUrl}/auth/me`, { withCredentials: true })
      .pipe(
        tap((user) => this.currentUser.set(user)),
        catchError(() => {
          this.currentUser.set(null);
          return of(null);
        }),
      );
  }

  /** FR-4 — sign out. Idempotent server-side (D-026), so no error handling here. */
  logout(): Observable<void> {
    return this.http
      .post<void>(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(tap(() => this.currentUser.set(null)));
  }

  /**
   * FR-10 / D-032 — change one's own password.
   *
   * Answers **204, not 200**, and carries no body: rule 3 keeps a password out
   * of every response, including this one. The server clears
   * `mustChangePassword`, so the local signal is updated to match rather than
   * left stale — otherwise the guard would keep redirecting a user who has
   * just complied.
   *
   * The one route reachable while flagged, alongside logout
   * (`requireAuthAllowingPasswordChange`).
   */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http
      .post<void>(
        `${environment.apiUrl}/auth/change-password`,
        { currentPassword, newPassword },
        { withCredentials: true },
      )
      .pipe(
        tap(() => {
          const user = this.currentUser();
          if (user) {
            this.currentUser.set({ ...user, mustChangePassword: false });
          }
        }),
      );
  }
}

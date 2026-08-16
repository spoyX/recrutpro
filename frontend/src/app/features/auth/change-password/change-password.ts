import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError, AuthService } from '../../../core/auth.service';

/**
 * FR-10's second half — the screen a user changes their own password on.
 *
 * NO NEW ENDPOINT: `POST /auth/change-password` has existed since D-032 and
 * nothing called it. The fifteenth run of the check.
 *
 * *** TWO MODES, ONE SCREEN, AND THE DIFFERENCE IS AN ESCAPE ROUTE. ***
 *   - **Forced** (`mustChangePassword`): FR-10's « contraint de le changer à la
 *     prochaine connexion ». There is NO cancel, because there is nowhere to
 *     cancel to — `requireAuth` 403s every other route until this is done. The
 *     only other exit is signing out, which is offered explicitly so the screen
 *     is not a trap.
 *   - **Voluntary**: reached from the topbar. It has a cancel, because every
 *     other page is available.
 *
 * NOT wrapped in `<app-shell>`, and that is deliberate. The shell's sidebar
 * links to pages a flagged user cannot open, and its notification bell would
 * fire a request that comes back 403 — chrome that advertises what the server
 * is refusing. The login screen makes the same choice.
 */
@Component({
  selector: 'app-change-password',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.scss',
})
export class ChangePassword {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** The server's own floor (`MIN_PASSWORD_LENGTH`), restated as guidance. */
  protected readonly minLength = 8;

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmation = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** Forced mode. Read from the signal, which survives a refresh (D-070). */
  readonly forced = computed(() => this.auth.currentUser()?.mustChangePassword === true);

  readonly userName = computed(() => this.auth.currentUser()?.name ?? '');

  /**
   * A confirmation field the SERVER does not have, and the one piece of
   * validation invented here rather than mirrored.
   *
   * It is justified by what this screen does: the value being typed becomes the
   * only way back in, and a typo is unrecoverable without another
   * administrator. Everything else on this screen defers to the server.
   */
  readonly mismatch = computed(
    () => this.confirmation().length > 0 && this.newPassword() !== this.confirmation(),
  );

  /** The server refuses a new password identical to the old one? It does not —
   * but reusing a temporary credential defeats FR-10, so it is blocked here and
   * the reason is stated. */
  readonly reused = computed(
    () => this.newPassword().length > 0 && this.newPassword() === this.currentPassword(),
  );

  readonly canSubmit = computed(
    () =>
      !this.busy() &&
      this.currentPassword().length > 0 &&
      this.newPassword().length >= this.minLength &&
      !this.mismatch() &&
      !this.reused() &&
      this.confirmation().length > 0,
  );

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.auth.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: () => {
        this.busy.set(false);
        // The service has already cleared `mustChangePassword` locally, so the
        // guard will not bounce this navigation straight back here.
        void this.router.navigate(['/dashboard']);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);

        const body = response.error as ApiError | null;
        // A 401 here means the CURRENT password was wrong — not an expired
        // session. Navigating to /login, as every other page does on a 401,
        // would throw away a session that is perfectly valid and make a typo
        // look like a timeout.
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le mot de passe n'a pas pu être changé. Réessayez."),
        );
      },
    });
  }

  /** The only other way out of the forced screen, so it is offered plainly. */
  logout(): void {
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }

  cancel(): void {
    void this.router.navigate(['/dashboard']);
  }
}

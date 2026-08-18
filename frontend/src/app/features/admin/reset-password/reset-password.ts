import { Component, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import { AdminService } from '../admin.service';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-10 — issue a temporary password.
 *
 * *** THIS COMPONENT HOLDS THE ONE CREDENTIAL THE SYSTEM EVER SHOWS, AND IT
 * SHOWS IT EXACTLY ONCE. *** D-031: the temporary password is generated
 * server-side, stored only as a hash, and returned in this single response. It
 * cannot be fetched again. That shapes everything here:
 *
 *   - **Two steps, never one click.** The password appears only after an
 *     explicit confirmation, so it is never on screen before someone is ready
 *     to copy it. A one-click reset would put a live credential on a screen
 *     nobody was looking at.
 *   - **It is never logged, never stored, never put in a URL.** It lives in one
 *     signal for the life of this dialog and dies with it (rule 3).
 *   - **Closing is deliberate and warned.** The dialog says the value cannot be
 *     recovered, because the honest alternative — pretending it can — would
 *     cost the account another reset.
 *
 * The account is also flipped to `mustChangePassword`, so the holder must
 * replace it at first sign-in; the dialog says so rather than implying this is
 * now their password.
 */
@Component({
  selector: 'app-reset-password',
  imports: [ModalFocus, MatButtonModule, MatIconModule],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private readonly admin = inject(AdminService);

  readonly userId = input.required<string>();
  readonly userName = input.required<string>();
  readonly userEmail = input.required<string>();

  /** Emitted on close, so the page can re-read the account's flags. */
  readonly finished = output<void>();
  readonly dismissed = output<void>();

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** Null until the reset succeeds. The ONLY place this value ever exists. */
  readonly temporaryPassword = signal<string | null>(null);
  readonly copied = signal(false);

  submit(): void {
    if (this.busy() || this.temporaryPassword() !== null) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.admin.resetPassword(this.userId()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.temporaryPassword.set(result.temporaryPassword);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le mot de passe n'a pas pu être réinitialisé. Réessayez."),
        );
      },
    });
  }

  /**
   * Best-effort. The clipboard API needs a secure context and permission, so a
   * failure is normal and must not look like the reset failed — the value stays
   * on screen to be selected by hand.
   */
  copy(): void {
    const value = this.temporaryPassword();
    if (!value) {
      return;
    }
    navigator.clipboard?.writeText(value).then(
      () => this.copied.set(true),
      () => this.copied.set(false),
    );
  }

  /** The password is gone once this closes, which is why closing is explicit. */
  close(): void {
    if (this.temporaryPassword() !== null) {
      this.finished.emit();
      return;
    }
    this.dismissed.emit();
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthService, ApiError } from '../../../core/auth.service';

/**
 * FR-1 — « La page de connexion comporte un champ email et un champ mot de
 * passe. » Built from DESIGN.md directly: no Figma reference exists for this
 * project, which ARCHITECTURE.md Section 4 explicitly provides for.
 *
 * Standalone, `inject()`, new control flow — Angular 20 idiom per D-008.
 */
@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** FR-10: the account must change its password before it can go anywhere. */
  readonly mustChangePassword = signal(false);

  submit(): void {
    if (this.form.invalid) {
      // NFR-09: surface which field is wrong rather than failing silently.
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.mustChangePassword.set(false);

    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: (user) => {
        this.submitting.set(false);

        // FR-10: requireAuth refuses every protected route with 403
        // PASSWORD_CHANGE_REQUIRED while this flag is set, so navigating to the
        // dashboard would only produce a confusing error. The change-password
        // screen is its own backlog item ("Password Reset flow"); until it
        // exists, say plainly what has happened rather than inventing a flow.
        if (user.mustChangePassword) {
          this.mustChangePassword.set(true);
          return;
        }

        void this.router.navigate(['/dashboard']);
      },
      error: (response: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorMessage.set(this.messageFor(response));
      },
    });
  }

  /**
   * FR-3 — one message for every credential failure. The server already sends
   * exactly « Email ou mot de passe incorrect » for a wrong password, an
   * unknown address AND a deactivated account (D-024), so the message is used
   * as sent rather than re-written here; re-writing it per status is how a
   * client accidentally re-introduces the enumeration leak the server took
   * care to avoid.
   */
  private messageFor(response: HttpErrorResponse): string {
    const body = response.error as ApiError | null;

    if (body?.error?.message) {
      return body.error.message;
    }

    // status 0 means the request never reached the API (network/CORS/offline).
    if (response.status === 0) {
      return "Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.";
    }

    return 'Une erreur est survenue. Réessayez dans un instant.';
  }
}

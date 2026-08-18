import { Component, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError, AuthService } from '../../core/auth.service';
import { UserAvatar } from '../user-avatar/user-avatar';
import { ModalFocus } from '../../shared/modal-focus/modal-focus';

/**
 * D-091 — manage your own profile photo.
 *
 * Opened from the topbar avatar, because that is where a user's own identity
 * already renders and there is no profile PAGE to put it on. Adding one would
 * be a route with a single form on it; a dialog from the thing it changes is
 * both less to build and closer to where the intent forms.
 *
 * NO CLIENT-SIDE FILE-TYPE CHECK, deliberately — the same call D-040 made for
 * the CV. `File.type` is the extension's claim, and an executable renamed to
 * `.jpg` reports `image/jpeg` quite happily. The magic-byte test in the backend
 * is the real gate (D-007/D-091) and its refusal is what the reader sees.
 * `accept` on the input is picker convenience and nothing more.
 *
 * The SIZE is checked here, though, and that is not an inconsistency: the
 * server enforces the same 2MB cap authoritatively, but refusing locally saves
 * pushing a rejected 8MB file up a slow connection first. A type cannot be
 * checked honestly in the browser; a length can.
 */
@Component({
  selector: 'app-profile-photo',
  imports: [ModalFocus, MatButtonModule, MatIconModule, MatProgressBarModule, UserAvatar],
  templateUrl: './profile-photo.html',
  styleUrl: './profile-photo.scss',
})
export class ProfilePhoto {
  private readonly auth = inject(AuthService);

  readonly dismissed = output<void>();

  protected readonly accept = this.auth.avatarAccept;
  protected readonly maxBytes = this.auth.avatarMaxBytes;

  protected readonly user = this.auth.currentUser;

  readonly file = signal<File | null>(null);
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /**
   * A local preview of the chosen file, so the user sees what they picked
   * before committing. `URL.createObjectURL` is revoked when the choice
   * changes, otherwise every re-pick leaks a blob for the tab's lifetime.
   */
  readonly previewUrl = signal<string | null>(null);

  readonly canSubmit = computed(() => this.file() !== null && !this.busy());
  readonly hasPhoto = computed(() => this.user()?.avatarUrl != null);

  chooseFile(files: FileList | null): void {
    const chosen = files?.[0] ?? null;
    this.errorMessage.set(null);
    this.revokePreview();

    if (chosen && chosen.size > this.maxBytes) {
      // Refused before the request, with the same limit the server enforces.
      this.file.set(null);
      this.errorMessage.set(
        "L'image dépasse la taille maximale de 2 Mo. Choisissez une image plus légère.",
      );
      return;
    }

    this.file.set(chosen);
    this.previewUrl.set(chosen ? URL.createObjectURL(chosen) : null);
  }

  submit(): void {
    const file = this.file();
    if (!file || this.busy()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.auth.uploadAvatar(file).subscribe({
      next: () => {
        this.busy.set(false);
        this.revokePreview();
        this.dismissed.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.errorMessage.set(this.messageFor(response));
      },
    });
  }

  remove(): void {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.auth.removeAvatar().subscribe({
      next: () => {
        this.busy.set(false);
        this.revokePreview();
        this.dismissed.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.errorMessage.set(this.messageFor(response));
      },
    });
  }

  cancel(): void {
    this.revokePreview();
    this.dismissed.emit();
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.previewUrl.set(null);
  }

  private messageFor(response: HttpErrorResponse): string {
    const body = response.error as ApiError | null;
    return (
      body?.error?.message ??
      (response.status === 0
        ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
        : "L'opération a échoué. Réessayez.")
    );
  }
}

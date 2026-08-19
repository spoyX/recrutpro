import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiError } from '../../../core/auth.service';
import { InterviewService } from '../interview.service';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-34 — cancelling a planned interview, with its mandatory motive.
 *
 * *** EXTRACTED, NOT COPIED. *** This lived inline in `interviews-list` and was
 * the only way to cancel anything: to call off an interview you had to leave
 * the candidate you were looking at, go to /interviews, and find the row again.
 * The candidate file now offers it too — and the way to give it two homes is
 * ONE component, not a second dialog that drifts from this one. FR-34's rule
 * that a motive is mandatory has exactly one client-side statement, here.
 *
 * The rule is the SERVER's regardless (D-046, whitespace included). The guard
 * below only saves a round trip; it grants nothing.
 */
@Component({
  selector: 'app-cancel-interview',
  imports: [ModalFocus, DatePipe, MatButtonModule],
  template: `
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-interview-title"
      (escaped)="dismiss()"
    >
      <div class="modal__panel">
        <h2 id="cancel-interview-title" class="modal__title">Annuler cet entretien</h2>
        <p class="modal__body">
          {{ candidateName() || 'Ce candidat' }} —
          {{ scheduledAt() | date: 'dd/MM/yyyy à HH:mm' }}.
          Le candidat reviendra à l'étape « Présélection CV validée ».
        </p>

        <label class="modal__label label-sm" for="cancel-interview-reason">
          Motif d'annulation
        </label>
        <textarea
          id="cancel-interview-reason"
          class="modal__input"
          rows="3"
          [disabled]="busy()"
          [value]="reason()"
          (input)="reason.set($any($event.target).value)"
        ></textarea>

        @if (errorMessage(); as message) {
          <p class="modal__error" role="alert">{{ message }}</p>
        }

        <div class="modal__actions">
          <button matButton type="button" [disabled]="busy()" (click)="dismiss()">Retour</button>
          <button
            matButton="filled"
            type="button"
            [disabled]="busy() || !canSubmit()"
            (click)="confirm()"
          >
            Confirmer l'annulation
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CancelInterview {
  private readonly interviews = inject(InterviewService);
  private readonly router = inject(Router);

  readonly interviewId = input.required<string>();
  readonly candidateName = input<string | null>(null);
  readonly scheduledAt = input.required<string>();

  /** The interview was cancelled; the host re-reads rather than patching. */
  readonly cancelled = output<void>();
  readonly dismissed = output<void>();

  readonly reason = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly canSubmit = computed(() => this.reason().trim().length > 0);

  dismiss(): void {
    if (this.busy()) return;
    this.dismissed.emit();
  }

  confirm(): void {
    const motive = this.reason().trim();
    // Mirrored client-side purely to save a round trip; the server enforces it
    // regardless (D-046), whitespace included.
    if (!motive) {
      this.errorMessage.set('Un motif est obligatoire pour annuler un entretien.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);
    this.interviews.cancelInterview(this.interviewId(), motive).subscribe({
      next: () => {
        this.busy.set(false);
        // The host RELOADS rather than patching a row: cancelling also reverts
        // the candidate's stage, and on the interview list a cancelled row
        // leaves the default view entirely (D-045/D-049). Guessing the new
        // shape would be a lie.
        this.cancelled.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }
        const body = response.error as ApiError | null;
        this.errorMessage.set(body?.error?.message ?? "L'annulation a échoué. Réessayez.");
      },
    });
  }
}

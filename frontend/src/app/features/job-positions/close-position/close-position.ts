import { Component, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { ApiError } from '../../../core/auth.service';
import { JobPositionService, JobPosition } from '../job-position.service';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-16 — close a position.
 *
 * NO NEW ENDPOINT: `POST /job-positions/:id/close` has existed since D-037.
 *
 * A confirmation rather than a plain button, because closure is the nearest
 * thing this module has to a deletion and FR-18/D-038 removed the real one: a
 * closed position cannot be edited (409), cannot be reopened, and accepts no
 * new candidate. The prompt states all three, since the consequence is not
 * recoverable from the UI once taken.
 *
 * A COMPONENT rather than the inline prompt pattern used for FR-34, because
 * this one is hosted twice — from the FR-17 list and from the details page.
 */
@Component({
  selector: 'app-close-position',
  imports: [ModalFocus, MatButtonModule],
  template: `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="close-position-title" (escaped)="dismissed.emit()">
      <div class="modal__panel">
        <h2 id="close-position-title" class="modal__title">Clôturer ce poste</h2>
        <p class="modal__body">
          {{ title() }} — la clôture est <strong>définitive</strong> : le poste ne pourra
          plus être modifié, aucun nouveau candidat ne pourra y être rattaché, et il n'existe
          pas d'action de réouverture. Les candidats déjà rattachés conservent leur dossier.
        </p>

        @if (errorMessage(); as message) {
          <p class="modal__error" role="alert">{{ message }}</p>
        }

        <div class="modal__actions">
          <button matButton type="button" [disabled]="busy()" (click)="dismissed.emit()">
            Retour
          </button>
          <button matButton="filled" type="button" [disabled]="busy()" (click)="submit()">
            Confirmer la clôture
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ClosePosition {
  private readonly positions = inject(JobPositionService);

  readonly positionId = input.required<string>();
  readonly title = input.required<string>();

  readonly closed = output<JobPosition>();
  readonly dismissed = output<void>();

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  submit(): void {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.positions.closePosition(this.positionId()).subscribe({
      next: (position) => {
        this.busy.set(false);
        this.closed.emit(position);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        const body = response.error as ApiError | null;
        // POSITION_ALREADY_CLOSED (409) arrives here like any other refusal:
        // the server deliberately reports a re-close rather than swallowing it
        // idempotently, so the reader is told rather than shown a false success.
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le poste n'a pas pu être clôturé. Réessayez."),
        );
      },
    });
  }
}

import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ModalFocus } from '../modal-focus/modal-focus';

/**
 * A dialog that only READS. Title, projected content, one dismiss button.
 *
 * It exists because /login needed three of them — contact, privacy, terms —
 * and they differ in nothing but their words. There is no form, no request and
 * no state: everything these show is static copy, so a component per topic
 * would be three copies of a close button.
 *
 * It inherits D-098's focus management for free by being a `role="dialog"`
 * with `aria-modal="true"`: `ModalFocus` matches on exactly that selector, so
 * focus moves in on open, Tab stays inside, Escape closes, and focus returns to
 * whatever opened it. That is the whole reason this uses the shared `.modal`
 * markup rather than inventing a panel.
 */
@Component({
  selector: 'app-info-dialog',
  imports: [ModalFocus, MatButtonModule, MatIconModule],
  template: `
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId()"
      (escaped)="dismissed.emit()"
    >
      <div class="modal__panel">
        <header class="info__head">
          <h2 [id]="titleId()" class="modal__title">{{ heading() }}</h2>
          <button
            type="button"
            class="info__close"
            aria-label="Fermer"
            (click)="dismissed.emit()"
          >
            <mat-icon aria-hidden="true">close</mat-icon>
          </button>
        </header>

        <div class="info__body">
          <ng-content />
        </div>

        <div class="modal__actions">
          <button matButton="filled" type="button" (click)="dismissed.emit()">Fermer</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .info__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--sp-md);
      }

      .info__close {
        display: grid;
        place-items: center;
        flex: none;
        /* WCAG 2.2 target size — this is a standalone control, not inline. */
        width: 32px;
        height: 32px;
        border: none;
        border-radius: var(--radius-default);
        background: none;
        color: var(--mat-sys-on-surface-variant);
        cursor: pointer;

        &:hover {
          background-color: var(--mat-sys-surface-container-low);
          color: var(--mat-sys-on-surface);
        }
      }

      .info__body {
        font: var(--mat-sys-body-medium);
        color: var(--mat-sys-on-surface-variant);

        p {
          margin: 0 0 var(--sp-md);
        }

        p:last-child {
          margin-bottom: 0;
        }

        strong {
          color: var(--mat-sys-on-surface);
        }
      }
    `,
  ],
})
export class InfoDialog {
  /** The dialog's heading, and what `aria-labelledby` points at. */
  readonly heading = input.required<string>();

  /** Distinct per instance so three dialogs on one page cannot share an id. */
  readonly titleId = input.required<string>();

  readonly dismissed = output<void>();
}

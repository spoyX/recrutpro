import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * A single headline number — DESIGN.md's Level 1 card, used for FR-45's
 * « nombre de postes ouverts », FR-46's counts and FR-47's active users.
 *
 * ARCHITECTURE.md Section 6 puts reusable presentational components in
 * shared/. This one earns its place immediately: four instances across the
 * three role dashboards.
 */
@Component({
  selector: 'app-stat-tile',
  imports: [MatIconModule],
  template: `
    <article class="tile">
      <div class="tile__head">
        <div class="tile__text">
          <p class="tile__label label-sm">{{ label() }}</p>
          <p class="tile__value">{{ value() }}</p>
        </div>
        <!-- 4.1 item 2.1: an optional glyph in a tinted square, so a row of
             tiles is scannable by shape as well as by reading each label. -->
        @if (icon(); as glyph) {
          <span class="tile__icon" aria-hidden="true">
            <mat-icon>{{ glyph }}</mat-icon>
          </span>
        }
      </div>
      @if (hint()) {
        <!-- 4.1 item 3.3: an URGENT hint is signal, not decoration — « Action
             requise » beside a pending count is the whole point of the tile. -->
        <p class="tile__hint" [class.tile__hint--urgent]="urgent()">
          @if (urgent()) {
            <mat-icon aria-hidden="true">priority_high</mat-icon>
          }
          <span>{{ hint() }}</span>
        </p>
      }
    </article>
  `,
  styles: `
    .tile {
      // DESIGN.md Elevation Level 1: white surface, 1px border, subtle shadow.
      background-color: var(--mat-sys-surface-container-lowest);
      border: var(--border-level-1);
      border-radius: var(--radius-default);
      box-shadow: var(--elevation-1);
      padding: var(--sp-lg);
      display: flex;
      flex-direction: column;
      gap: var(--sp-xs);
    }
    .tile__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--sp-md);
    }
    .tile__text {
      display: flex;
      flex-direction: column;
      gap: var(--sp-xs);
      min-width: 0;
    }
    // A quiet tint, never a saturated fill: the NUMBER is the tile's subject
    // and an icon competing with it would inverts the hierarchy.
    .tile__icon {
      flex: none;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-default);
      background-color: var(--mat-sys-secondary-fixed);
      color: var(--mat-sys-on-secondary-fixed-variant);
    }
    .tile__label {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    .tile__value {
      // The one number the tile exists for, so it takes the display size.
      font: var(--mat-sys-headline-large);
      letter-spacing: var(--recrutpro-tracking-headline-xl);
      color: var(--mat-sys-on-surface);
      margin: 0;
    }
    .tile__hint {
      display: flex;
      align-items: center;
      gap: var(--sp-xs);
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }
    // DESIGN.md's ATTENTION role (D-080): wants notice, neither good nor bad.
    // NOT the error role — nothing has gone wrong, there is work waiting.
    .tile__hint--urgent {
      color: var(--mat-sys-on-tertiary-fixed-variant);
      font-weight: 600;
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly hint = input<string | null>(null);
  /** Material glyph name. Omitted leaves the tile exactly as it was. */
  readonly icon = input<string | null>(null);
  /** Renders the hint in the attention role — for a count that needs acting on. */
  readonly urgent = input(false);
}

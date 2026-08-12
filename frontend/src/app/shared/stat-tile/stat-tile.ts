import { Component, input } from '@angular/core';

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
  template: `
    <article class="tile">
      <p class="tile__label label-sm">{{ label() }}</p>
      <p class="tile__value">{{ value() }}</p>
      @if (hint()) {
        <p class="tile__hint">{{ hint() }}</p>
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
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<number | string>();
  readonly hint = input<string | null>(null);
}

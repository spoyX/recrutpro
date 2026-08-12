import { Component, computed, input } from '@angular/core';

/**
 * FR-45 « la répartition des candidats par étape (graphique ou compteurs) »,
 * reused by FR-46's department pipeline.
 *
 * Bars are plain CSS widths — no charting dependency is added for seven
 * horizontal bars, and DESIGN.md explicitly permits counters.
 *
 * Every stage the API sends is rendered, INCLUDING zeroes: the backend
 * zero-fills all seven deliberately (D-057) so the chart's rows do not move
 * between renders, and dropping them here would undo that.
 */
@Component({
  selector: 'app-pipeline-breakdown',
  template: `
    <div class="pipeline">
      @for (row of rows(); track row.stage) {
        <div class="pipeline__row">
          <span class="pipeline__label">{{ row.stage }}</span>
          <span class="pipeline__track">
            <span class="pipeline__bar" [style.width.%]="row.percent"></span>
          </span>
          <span class="pipeline__count">{{ row.count }}</span>
        </div>
      } @empty {
        <p class="pipeline__empty">Aucune donnée de pipeline.</p>
      }
    </div>
  `,
  styles: `
    .pipeline {
      display: flex;
      flex-direction: column;
      gap: var(--sp-sm);
    }
    .pipeline__row {
      display: grid;
      // Label column is fixed so the bars share one baseline and are
      // comparable at a glance; that is the whole point of the widget.
      grid-template-columns: minmax(9rem, 14rem) 1fr 2.5rem;
      align-items: center;
      gap: var(--sp-md);
    }
    .pipeline__label {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .pipeline__track {
      height: 8px;
      border-radius: var(--radius-full);
      background-color: var(--mat-sys-surface-container-high);
      overflow: hidden;
    }
    .pipeline__bar {
      display: block;
      height: 100%;
      border-radius: var(--radius-full);
      background-color: var(--mat-sys-primary);
      // A zero-count stage still shows its row and label, just no bar.
      min-width: 0;
    }
    .pipeline__count {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pipeline__empty {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }
    @media (max-width: 600px) {
      .pipeline__row {
        grid-template-columns: 1fr 2.5rem;
      }
      .pipeline__track {
        display: none;
      }
    }
  `,
})
export class PipelineBreakdown {
  readonly breakdown = input.required<Record<string, number>>();

  readonly rows = computed(() => {
    const entries = Object.entries(this.breakdown() ?? {});
    // Scale against the largest stage, not the total: with one dominant stage
    // every other bar would be invisible against a total-based denominator.
    const max = Math.max(1, ...entries.map(([, count]) => count));

    return entries.map(([stage, count]) => ({
      stage,
      count,
      percent: (count / max) * 100,
    }));
  });
}

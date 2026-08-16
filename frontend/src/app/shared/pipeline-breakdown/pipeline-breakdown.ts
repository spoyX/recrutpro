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
/**
 * ARCHITECTURE.md Section 8's three terminal stages. Listed here rather than
 * inferred, because "is this an outcome?" is a pipeline fact and not a string
 * pattern — « Rejeté (CV) » and « Rejeté » differ by more than a suffix.
 */
const TERMINAL = ['Accepté', 'Rejeté', 'Rejeté (CV)'] as const;

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

      <!--
        4.1 item 2.2 — the terminal outcomes are SEPARATED from the queue.
        A bar chart compares like with like, and « Accepté » is not a longer or
        shorter version of « Entretien planifié »: one is a settled result, the
        others are work in progress. Rendering all seven as bars invited the
        reader to compare a result against a queue length. Same numbers, same
        payload — only the grouping changed.
      -->
      @if (terminal().length) {
        <div class="pipeline__outcomes">
          @for (row of terminal(); track row.stage) {
            <div class="outcome">
              <span class="outcome__label label-sm">{{ row.stage }}</span>
              <span class="outcome__count" [class.outcome__count--negative]="row.negative">
                {{ row.count }}
              </span>
            </div>
          }
        </div>
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
    .pipeline__outcomes {
      display: flex;
      gap: var(--sp-md);
      margin-top: var(--sp-sm);
      padding-top: var(--sp-md);
      border-top: var(--border-level-1);
    }
    .outcome {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-xs);
      padding: var(--sp-sm);
      border-radius: var(--radius-default);
      background-color: var(--mat-sys-surface-container-low);
    }
    .outcome__label {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
      text-align: center;
    }
    .outcome__count {
      font: var(--mat-sys-headline-medium);
      color: var(--mat-sys-on-surface);
      font-variant-numeric: tabular-nums;
    }
    // The negative outcomes read in the error role, matching every other
    // terminal rejection in the app (D-066's success/error pairing).
    .outcome__count--negative {
      color: var(--mat-sys-error);
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

  /** The terminal outcomes, split out of the bars (4.1 item 2.2). */
  readonly terminal = computed(() => {
    const breakdown = this.breakdown() ?? {};
    // Ordered by TERMINAL, NOT by the payload's key order. Iterating the object
    // put « Rejeté (CV) » first purely because of JSON key order — the same
    // class of instability D-069 fixed in the database sorts, and just as
    // invisible until something depends on the order.
    return TERMINAL.filter((stage) => stage in breakdown).map((stage) => ({
      stage,
      count: breakdown[stage],
      negative: stage !== 'Accepté',
    }));
  });

  readonly rows = computed(() => {
    // Only the IN-PROGRESS stages are bars now.
    const entries = Object.entries(this.breakdown() ?? {}).filter(
      ([stage]) => !(TERMINAL as readonly string[]).includes(stage),
    );
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

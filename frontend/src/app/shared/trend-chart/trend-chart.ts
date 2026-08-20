import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

/**
 * D-109 — a time-series chart, and the table that says the same thing in words.
 *
 * *** THE TABLE IS NOT OPTIONAL DECORATION. *** Every number this app shows is
 * also readable as text: the stat tiles, the pipeline bars, the evaluation
 * dots. A canvas is invisible to a screen reader, unreadable at a glance for
 * an exact value, and gone entirely if the script fails. So the series renders
 * TWICE — once as pixels, once as a `<table>` — and the table is the copy that
 * is guaranteed to be right.
 *
 * *** ONLY THE REGISTRATIONS TWO CHARTS NEED. *** `Chart.register(...registerables)`
 * pulls in doughnut, radar, polar, bubble and scatter for nothing. Measured:
 * the hand-picked set costs 53.28 kB transfer against 66.21 kB for the default.
 *
 * NO ng2-charts (D-109). Its Angular peer dependency is the problem, not its
 * size: v10 already requires Angular 21 while this app is on 20, so the wrapper
 * would pin us to v9 and become a blocker at the next Angular upgrade. chart.js
 * has no Angular peer dependency at all.
 */
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
);

export interface TrendPoint {
  /** The x-axis label, already formatted for a human. */
  label: string;
  /**
   * The value, or NULL for "no data here".
   *
   * Null is not zero and must not be drawn as zero — see `spanGaps` below.
   */
  value: number | null;
}

@Component({
  selector: 'app-trend-chart',
  imports: [],
  template: `
    <figure class="trend">
      <figcaption class="trend__caption">
        <span class="trend__title">{{ title() }}</span>
        <span class="trend__hint">{{ hint() }}</span>
      </figcaption>

      <!-- role="img" plus the label: a screen reader is told what this is and
           then sent to the table below, rather than being read a bare canvas. -->
      <div class="trend__canvas">
        <canvas #canvas [attr.aria-label]="title() + '. ' + summary()" role="img"></canvas>
      </div>

      <!-- The same numbers, in words. Never visually-hidden: an exact value
           is easier to read here than off a bar, for everyone. -->
      <table class="trend__table">
        <caption class="visually-hidden">{{ title() }} — valeurs exactes</caption>
        <thead>
          <tr>
            <th scope="col">Mois</th>
            <th scope="col">{{ valueLabel() }}</th>
          </tr>
        </thead>
        <tbody>
          @for (point of points(); track point.label) {
            <tr>
              <th scope="row">{{ point.label }}</th>
              <td [class.trend__none]="point.value === null">
                @if (point.value === null) {
                  <!-- Not « 0 ». A month with no hires has no average, and a
                       zero would claim those nobodies were hired instantly. -->
                  <span aria-label="aucune donnée">—</span>
                } @else {
                  {{ point.value }}{{ unit() }}
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </figure>
  `,
  styleUrl: './trend-chart.scss',
})
export class TrendChart implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly hint = input('');
  readonly points = input.required<TrendPoint[]>();
  readonly kind = input<'bar' | 'line'>('bar');
  /** Header for the table's value column. */
  readonly valueLabel = input('Valeur');
  /** Suffix on a rendered value, e.g. « j » for days. */
  readonly unit = input('');
  /** A DESIGN.md token value — never a chart.js default. */
  readonly colour = input('#1D4ED8');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  /** What a screen reader hears in place of the picture. */
  protected readonly summary = computed(() => {
    const known = this.points().filter((p) => p.value !== null);
    if (!known.length) {
      return 'Aucune donnée sur la période.';
    }
    const first = known[0];
    const last = known[known.length - 1];
    return (
      `${known.length} mois avec des données, de ${first.label} (${first.value}${this.unit()}) ` +
      `à ${last.label} (${last.value}${this.unit()}). Valeurs exactes dans le tableau ci-dessous.`
    );
  });

  constructor() {
    // Redraw when the inputs change — the period filter re-fetches, so the
    // series arrives more than once.
    effect(() => {
      const points = this.points();
      this.kind();
      this.colour();
      if (this.chart) {
        this.draw(points);
      }
    });
  }

  ngAfterViewInit(): void {
    this.draw(this.points());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  private draw(points: TrendPoint[]): void {
    this.chart?.destroy();

    const config: ChartConfiguration = {
      type: this.kind(),
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
            label: this.valueLabel(),
            data: points.map((p) => p.value),
            backgroundColor: this.kind() === 'bar' ? this.colour() : 'transparent',
            borderColor: this.colour(),
            borderWidth: 2,
            pointBackgroundColor: this.colour(),
            pointRadius: 3,
            // *** THE WHOLE POINT OF NULL. *** `spanGaps: false` leaves a
            // BREAK in the line where a month has no data, instead of joining
            // the two months either side and drawing a slope through a month
            // that never happened. On the bar chart a null simply draws no bar.
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // NO entry animation, for two reasons and neither is test convenience.
        // A report is read, not watched: bars growing out of the axis every
        // time the period filter changes is motion that carries no meaning.
        // And chart.js animates via requestAnimationFrame, which a browser
        // THROTTLES in a background or occluded window - so an animated chart
        // can sit blank until the tab is looked at. Drawing once, immediately,
        // is both quieter and more reliable.
        animation: false,
        // The table below carries the legend's information already, and one
        // dataset does not need naming twice.
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };

    this.chart = new Chart(this.canvas().nativeElement, config);
  }
}

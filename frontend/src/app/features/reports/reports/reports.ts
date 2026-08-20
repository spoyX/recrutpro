import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subject, switchMap, catchError, EMPTY } from 'rxjs';
import { ApiError, AuthService } from '../../../core/auth.service';
import { ReportService, PipelineRow, TimeToHire } from '../report.service';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';
import { StatTile } from '../../../shared/stat-tile/stat-tile';
import { PipelineBreakdown } from '../../../shared/pipeline-breakdown/pipeline-breakdown';
import { TrendChart, TrendPoint } from '../../../shared/trend-chart/trend-chart';

/**
 * SRS Section 1.5 — the Reports page. User story 22 (pipeline par poste) and
 * user story 23 (délai moyen de recrutement).
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE — the eighth page running, and the
 * **thirteenth** time the check has said no. `GET /reports/pipeline` and
 * `GET /reports/time-to-hire` have existed since D-059 and nothing called them.
 *
 * ROLES, checked in `report.routes.ts` rather than assumed — and the route is
 * the authority here, because the SERVICE's own docblock still says the
 * Administrateur is refused, which D-068 superseded:
 *   - **Recruteur** — the whole organisation.
 *   - **Responsable hiérarchique** — their own department only, scoped inside
 *     the service (rule 2, D-047). The page SAYS so for that role, because a
 *     responsable seeing three postings must not read that as the company
 *     having three.
 *   - **Administrateur** — allowed since D-068, and NOT department-scoped
 *     (D-027), so they see everything. Both routes are GETs, so "read-only"
 *     needs no separate guard: the module exposes no write at all.
 *
 * NO CHARTING DEPENDENCY, and no invented chart either. DESIGN.md says nothing
 * about charts, and rule 8 forbids inventing a UI style at the point of use —
 * so this reuses `PipelineBreakdown`, which already renders seven CSS bars for
 * the FR-45/FR-46 dashboards, and `StatTile`, which already renders a figure
 * with a hint.
 */
@Component({
  selector: 'app-reports',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    StageChip,
    StatTile,
    PipelineBreakdown,
    TrendChart,
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports {
  private readonly reports = inject(ReportService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pipelineTrigger$ = new Subject<void>();
  private readonly timeToHireTrigger$ = new Subject<void>();
  protected readonly auth = inject(AuthService);

  // ------------------------------------------------------- user story 22

  readonly rows = signal<PipelineRow[]>([]);
  readonly pipelineLoading = signal(true);
  readonly pipelineError = signal<string | null>(null);
  readonly selectedPosition = signal<string>('');

  /**
   * The poste filter's options, derived from the ROWS the report returned.
   *
   * Not from `GET /job-positions`: D-038 closes that endpoint to the
   * Responsable hiérarchique entirely, so for one of the three roles allowed
   * here there would be no picker at all. The same reasoning as the FR-33
   * interview list. Deriving also means an option can never match nothing.
   */
  readonly positionOptions = computed(() =>
    this.rows().map((row) => ({ id: row.jobPosition.id, title: row.jobPosition.title })),
  );

  /** The stage columns, taken from the payload rather than hard-coded. */
  readonly stageNames = computed(() => Object.keys(this.rows()[0]?.stages ?? {}));

  /** Candidates across every visible position — the report's own denominator. */
  readonly grandTotal = computed(() => this.rows().reduce((sum, row) => sum + row.total, 0));

  /**
   * Rendered only when the filter names ONE position, which is the mode the
   * endpoint's `jobPositionId` parameter exists for.
   */
  readonly focused = computed(() =>
    this.selectedPosition() && this.rows().length === 1 ? this.rows()[0] : null,
  );

  /** True for the role the server narrows, so the page can state the scope. */
  readonly isScoped = computed(
    () => this.auth.currentUser()?.role === 'ResponsableHierarchique',
  );

  // ------------------------------------------------------- user story 23

  readonly hire = signal<TimeToHire | null>(null);
  readonly hireLoading = signal(true);
  readonly hireError = signal<string | null>(null);
  readonly fromDate = signal('');
  readonly toDate = signal('');

  /** True while a range is narrowing the figures, so the page can say so. */
  readonly isPeriodFiltered = computed(() => !!this.fromDate() || !!this.toDate());

  /**
   * An average over a couple of hires is arithmetic, not a statistic — the
   * server returns `hires` precisely so a reader can tell, and the page warns
   * rather than leaving the number to be over-read.
   */
  readonly smallSample = computed(() => {
    const report = this.hire();
    return report !== null && report.hires > 0 && report.hires < 5;
  });

  // -------------------------------------------------- D-109/D-110: the charts

  /**
   * DESIGN.md tokens, not chart.js defaults.
   *
   * `primary` for volume and `secondary` for the delay: two different
   * questions, two different hues, both already in the palette. Read as
   * literals rather than through `var(--mat-sys-*)` because chart.js paints
   * into a CANVAS — a CSS custom property means nothing to a 2D context, and
   * passing one would silently draw black.
   */
  protected readonly volumeColour = '#1D4ED8';
  protected readonly delayColour = '#0058BE';

  /** `2026-07` reads as « juil. 2026 » on an axis. */
  private monthLabel(key: string): string {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('fr-FR', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  /** Hires per month. A quiet month is a real zero, so it stays a zero. */
  readonly volumeSeries = computed<TrendPoint[]>(() =>
    (this.hire()?.byMonth ?? []).map((m) => ({
      label: this.monthLabel(m.month),
      value: m.hires,
    })),
  );

  /**
   * Average days-to-hire per month.
   *
   * `averageDays` is passed through UNTOUCHED, nulls included: a month with no
   * hires has no average, and coercing it to 0 would draw a plunge to the axis
   * that reads as a dramatic improvement. The chart leaves a gap.
   */
  readonly delaySeries = computed<TrendPoint[]>(() =>
    (this.hire()?.byMonth ?? []).map((m) => ({
      label: this.monthLabel(m.month),
      value: m.averageDays,
    })),
  );

  /** True once there is anything at all to plot. */
  readonly hasSeries = computed(() => (this.hire()?.byMonth ?? []).length > 0);

  constructor() {
    this.pipelineTrigger$
      .pipe(
        switchMap(() => {
          this.pipelineLoading.set(true);
          this.pipelineError.set(null);
          return this.reports.pipeline(this.selectedPosition() || undefined).pipe(
            catchError((response: HttpErrorResponse) => {
              this.pipelineLoading.set(false);
              this.rows.set([]);
              this.pipelineError.set(this.messageFor(response, 'Le rapport de pipeline'));
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.rows.set(rows);
        this.pipelineLoading.set(false);
      });

    this.timeToHireTrigger$
      .pipe(
        switchMap(() => {
          this.hireLoading.set(true);
          this.hireError.set(null);
          return this.reports
            .timeToHire(this.fromDate() || undefined, this.toDate() || undefined)
            .pipe(
              catchError((response: HttpErrorResponse) => {
                this.hireLoading.set(false);
                this.hire.set(null);
                this.hireError.set(this.messageFor(response, 'Le délai de recrutement'));
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((report) => {
        this.hire.set(report);
        this.hireLoading.set(false);
      });

    this.loadPipeline();
    this.loadTimeToHire();
  }

  loadPipeline(): void {
    this.pipelineTrigger$.next();
  }

  loadTimeToHire(): void {
    this.timeToHireTrigger$.next();
  }

  selectPosition(value: string): void {
    this.selectedPosition.set(value);
    this.loadPipeline();
  }

  setFrom(value: string): void {
    this.fromDate.set(value);
    this.loadTimeToHire();
  }

  setTo(value: string): void {
    this.toDate.set(value);
    this.loadTimeToHire();
  }

  resetPeriod(): void {
    this.fromDate.set('');
    this.toDate.set('');
    this.loadTimeToHire();
  }

  /**
   * The two reports fail INDEPENDENTLY and are reported separately: they are
   * two requests, and a broken time-to-hire must not blank a pipeline that
   * loaded perfectly well.
   */
  private messageFor(response: HttpErrorResponse, subject: string): string {
    // FR-2 expiry or FR-8 deactivation — signing in again is the only useful
    // action, so go there rather than showing a dead error.
    if (response.status === 401) {
      void this.router.navigate(['/login']);
      return '';
    }

    // The server's own message first: an inverted date range answers with a
    // 400 explaining exactly that, and « momentanément indisponible » would
    // describe a fixable mistake as an outage (NFR-09).
    const body = response.error as ApiError | null;
    return (
      body?.error?.message ??
      (response.status === 0
        ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
        : `${subject} est momentanément indisponible. Réessayez.`)
    );
  }
}

import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subject, switchMap, catchError, EMPTY } from 'rxjs';
import { AuthService, ApiError } from '../../../core/auth.service';
import {
  InterviewService,
  InterviewListItem,
  InterviewListQuery,
  INTERVIEW_PAGE_SIZE,
} from '../interview.service';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';
import { EvaluationForm } from '../evaluation-form/evaluation-form';
import { CancelInterview } from '../cancel-interview/cancel-interview';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { pageWindow } from '../../../shared/page-window';
import { InterviewCalendar } from '../interview-calendar/interview-calendar';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/** One day's interviews, so the list reads as a schedule rather than a table. */
export interface InterviewDay {
  /** LOCAL calendar day (yyyy-mm-dd), the group key. */
  date: string;
  /**
   * An instant from this group, formatted for the heading. Kept as the raw
   * timestamp rather than reusing `date`: a date-only string is parsed as UTC
   * midnight and can format back to the previous day in a negative offset,
   * which would print a heading contradicting the times underneath it.
   */
  heading: string;
  rows: InterviewListItem[];
}

/**
 * FR-33 / FR-35 — the interview schedule.
 *
 * ONE route serves both roles and the SERVER decides the scope (D-047): a
 * Recruteur sees every interview, a Responsable hiérarchique only their own
 * assignments, with rule 2's department floor on top. There is no client-side
 * role check here (NFR-04, the D-064 rule); the page renders what it is given.
 *
 * NO NEW ENDPOINT. D-045 claimed `GET /interviews` "returns everything a
 * calendar needs" and that was verified against the view before building.
 * `GET /interviews/:id` was NOT needed — every field this page shows is on the
 * list row, so it stays unbuilt rather than built speculatively.
 *
 * FR-33 asks for « vue liste **ou** calendrier ». This is the list, grouped by
 * day so it reads as a schedule; a month grid would be considerably more code
 * for a requirement the list already satisfies.
 *
 * NOT BUILT — FR-30/FR-31/FR-32 scheduling. See the note in TASKS.md: a
 * Recruteur cannot discover an interviewer's id through any endpoint
 * (`GET /users` is Administrateur-only), so the form is blocked on a human
 * decision rather than on effort.
 */
@Component({
  selector: 'app-interviews-list',
  imports: [ModalFocus, 
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    UserAvatar,
    StageChip,
    EvaluationForm,
    CancelInterview,
    InterviewCalendar,
  ],
  templateUrl: './interviews-list.html',
  styleUrl: './interviews-list.scss',
})
export class InterviewsList {
  private readonly interviews = inject(InterviewService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loadTrigger$ = new Subject<void>();
  protected readonly auth = inject(AuthService);

  protected readonly pageSize = INTERVIEW_PAGE_SIZE;

  readonly rows = signal<InterviewListItem[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly filters = signal<InterviewListQuery>({});
  readonly includeFinished = signal(false);

  /**
   * D-094 — FR-33 offers « vue liste OU calendrier », so both are kept and the
   * calendar is the default. They SHARE the filter state above: switching view
   * changes the drawing, never the data or the scope.
   */
  protected readonly viewOptions = [
    { value: 'calendar' as const, label: 'Calendrier', icon: 'calendar_month' },
    { value: 'list' as const, label: 'Liste', icon: 'view_list' },
  ];
  readonly view = signal<'calendar' | 'list'>('calendar');
  readonly sortDir = signal<'asc' | 'desc'>('asc');

  /** The interview opened from the calendar, or null. */
  readonly selected = signal<InterviewListItem | null>(null);

  /** The row awaiting a cancellation motive, or null. */
  readonly cancelling = signal<InterviewListItem | null>(null);

  readonly rangeStart = computed(() => (this.total() === 0 ? 0 : this.offset() + 1));
  readonly rangeEnd = computed(() => Math.min(this.offset() + this.rows().length, this.total()));
  readonly hasPrevious = computed(() => this.offset() > 0);
  readonly hasNext = computed(() => this.rangeEnd() < this.total());
  readonly isFiltered = computed(() => Object.values(this.filters()).some((v) => !!v));

  /** Numbered pages, same arithmetic as /candidates (shared/page-window.ts). */
  readonly pages = computed(() => pageWindow(this.total(), this.offset(), this.pageSize));

  /**
   * Filter options are derived from the ROWS ON SCREEN, not from a user or
   * position endpoint. Two reasons: a Responsable hiérarchique cannot read
   * either (`GET /users` is Administrateur-only, `GET /job-positions` is
   * closed to them by D-038), and an option that matches nothing is a filter
   * that looks broken. You can only narrow to something you can already see.
   */
  readonly interviewerOptions = computed(() =>
    this.distinct(this.rows().map((r) => r.interviewer)),
  );
  readonly positionOptions = computed(() =>
    this.distinct(this.rows().map((r) => (r.jobPosition ? { id: r.jobPosition.id, name: r.jobPosition.title } : null))),
  );

  private distinct(
    refs: Array<{ id: string; name: string } | null>,
  ): Array<{ id: string; name: string }> {
    const byId = new Map<string, { id: string; name: string }>();
    for (const ref of refs) {
      if (ref) byId.set(ref.id, ref);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  /**
   * Rows grouped by LOCAL calendar day, preserving the server's ordering.
   *
   * The key is built from local date parts, NOT from `scheduledAt.slice(0,10)`:
   * that is the UTC date, and the times below each heading render in the
   * viewer's timezone — so a 23:30 UTC slot would appear under the previous
   * day's heading while showing the next day's time.
   */
  readonly days = computed<InterviewDay[]>(() => {
    const groups: InterviewDay[] = [];
    for (const row of this.rows()) {
      const at = new Date(row.scheduledAt);
      const date = [
        at.getFullYear(),
        String(at.getMonth() + 1).padStart(2, '0'),
        String(at.getDate()).padStart(2, '0'),
      ].join('-');

      const last = groups.at(-1);
      if (last && last.date === date) {
        last.rows.push(row);
      } else {
        groups.push({ date, heading: row.scheduledAt, rows: [row] });
      }
    }
    return groups;
  });

  constructor() {
    this.loadTrigger$
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          this.errorMessage.set(null);
          return this.interviews
            .listInterviews({
              ...this.filters(),
              includeFinished: this.includeFinished() || undefined,
              limit: this.pageSize,
              offset: this.offset(),
              sortBy: 'scheduledAt',
              sortDir: this.sortDir(),
            })
            .pipe(
              catchError((response: HttpErrorResponse) => {
                this.loading.set(false);
                this.rows.set([]);
                this.total.set(0);

                if (response.status === 401) {
                  void this.router.navigate(['/login']);
                  return EMPTY;
                }

                const body = response.error as ApiError | null;
                this.errorMessage.set(
                  body?.error?.message ??
                    (response.status === 0
                      ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                      : 'Le planning des entretiens est momentanément indisponible. Réessayez.'),
                );
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((page) => {
        if (page.items.length === 0 && page.total > 0 && this.offset() >= page.total) {
          this.offset.set(Math.max(0, Math.floor((page.total - 1) / this.pageSize) * this.pageSize));
          this.load();
          return;
        }

        this.rows.set(page.items);
        this.total.set(page.total);
        this.loading.set(false);
      });

    this.load();
  }

  setView(view: 'calendar' | 'list'): void {
    this.view.set(view);
    // The list paginates and the calendar fetches its own window, so whichever
    // becomes visible re-reads. Returning to the list resets to page 1 rather
    // than restoring an offset that may no longer exist.
    if (view === 'list') {
      this.offset.set(0);
      this.load();
    }
  }

  /**
   * A calendar click opens the SAME actions a list row offers — the cancel
   * dialog and the evaluation form are reused, not reimplemented, so FR-34's
   * mandatory motive cannot be bypassed by arriving from the other view.
   */
  openFromCalendar(row: InterviewListItem): void {
    this.selected.set(row);
  }

  closeSelected(): void {
    this.selected.set(null);
  }

  load(): void {
    this.loadTrigger$.next();
  }

  setFilter(key: keyof InterviewListQuery, value: string): void {
    this.filters.update((current) => ({ ...current, [key]: value || undefined }));
    this.offset.set(0);
    this.load();
  }

  toggleFinished(): void {
    this.includeFinished.update((v) => !v);
    this.offset.set(0);
    this.load();
  }

  toggleSort(): void {
    this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    this.offset.set(0);
    this.load();
  }

  resetFilters(): void {
    this.filters.set({});
    this.includeFinished.set(false);
    this.offset.set(0);
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pages().count || page === this.pages().current) return;
    this.offset.set((page - 1) * this.pageSize);
    this.load();
  }

  previousPage(): void {
    if (!this.hasPrevious()) return;
    this.offset.update((o) => Math.max(0, o - this.pageSize));
    this.load();
  }

  nextPage(): void {
    if (!this.hasNext()) return;
    this.offset.update((o) => o + this.pageSize);
    this.load();
  }

  // ------------------------------------------------------------ FR-34

  /** Only a PLANNED interview can be cancelled; the server refuses the rest. */
  canCancel(row: InterviewListItem): boolean {
    return row.status === 'Planifié' && this.auth.currentUser()?.role === 'Recruteur';
  }

  startCancel(row: InterviewListItem): void {
    this.cancelling.set(row);
  }

  dismissCancel(): void {
    this.cancelling.set(null);
  }

  /**
   * FR-34 succeeded. Reload rather than patch the row: cancelling also reverts
   * the candidate's stage, and by default a cancelled interview leaves this
   * list entirely (D-045/D-049).
   */
  onCancelled(): void {
    this.cancelling.set(null);
    this.load();
  }

  // ------------------------------------------------------ FR-36, FR-37

  /** The row awaiting an evaluation, or null. */
  readonly evaluating = signal<InterviewListItem | null>(null);

  /**
   * Whether to OFFER the evaluation form — an affordance, not a permission.
   *
   * All three conditions mirror rules the SERVER applies (D-048): only the
   * assigned Responsable hiérarchique, only a `Planifié` interview, and only
   * once the slot has passed — FR-36 says « APRÈS un entretien ». Mirrored so
   * the button is never present to be clicked into a 403 or a 409, never to
   * grant anything: `POST /interviews/:id/evaluation` re-checks every one of
   * them, the assignment through the same predicate as the FR-35 list itself.
   *
   * The `interviewerId` is deliberately NOT compared here. The server already
   * scopes this list to the caller's own assignments (D-047), so a client-side
   * comparison would restate a guarantee it cannot make (NFR-04, D-064).
   */
  canEvaluate(row: InterviewListItem): boolean {
    return (
      row.status === 'Planifié' &&
      this.auth.currentUser()?.role === 'ResponsableHierarchique' &&
      new Date(row.scheduledAt).getTime() <= Date.now()
    );
  }

  startEvaluate(row: InterviewListItem): void {
    this.evaluating.set(row);
  }

  /** FR-38: the interview becomes `Réalisé` and leaves the default view. */
  onEvaluated(): void {
    this.evaluating.set(null);
    // Reload rather than patch, for exactly D-046's reason on cancellation:
    // submitting also flips the interview to `Réalisé` and advances the
    // candidate, so the row's new shape is the server's to state, not ours to
    // guess — and by default it disappears from this list entirely (D-049).
    this.load();
  }

}

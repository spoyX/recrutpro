import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg, EventInput, DatesSetArg } from '@fullcalendar/core';
import frLocale from '@fullcalendar/core/locales/fr';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import { ApiError } from '../../../core/auth.service';
import {
  InterviewService,
  InterviewListItem,
  InterviewListQuery,
} from '../interview.service';

/**
 * FR-33 — the interview schedule as a calendar (D-094, D-096).
 *
 * *** THERE IS NO DRAG-TO-RESCHEDULE, AND THAT IS NOT AN OMISSION. ***
 *
 * `editable` is FALSE, deliberately. The endpoint check was run before this
 * component was written and `/interviews` has exactly four routes: create,
 * list, cancel, evaluate. **`PATCH /interviews/:id` was STRUCK from the
 * contract by D-066** — "FR-34 cancels an interview; nothing grants
 * rescheduling or editing one in place."
 *
 * So there is nowhere to persist a moved block. The two alternatives were both
 * rejected:
 *
 *  - **Let the block drag and snap back.** A gesture that appears to work and
 *    silently undoes itself is worse than one that is not offered.
 *  - **Make a drag mean cancel-then-recreate.** That destroys the interview's
 *    identity (new id, evaluations orphaned), and FR-34 requires a MOTIVE for
 *    every cancellation — which a drag cannot collect without a dialog, at
 *    which point it is a form, not a drag.
 *
 * Rescheduling remains what the SRS says it is: cancel with a reason, then
 * schedule again. Clicking a block offers exactly those actions. **Do not
 * enable `editable` without a ratified route to persist it to.**
 *
 * *** THE MIT PACKAGE SET ONLY (D-096). *** dayGrid, timeGrid, list and core.
 * `@fullcalendar/resource*` and `@fullcalendar/timeline` are PAID and must
 * never be added — including for the swimlane-per-interviewer view that is the
 * natural next request. Overlapping blocks already render side by side, which
 * is the conflict visibility FR-31/D-005 actually needs.
 */
@Component({
  selector: 'app-interview-calendar',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, FullCalendarModule],
  templateUrl: './interview-calendar.html',
  styleUrl: './interview-calendar.scss',
})
export class InterviewCalendar {
  private readonly interviews = inject(InterviewService);

  /** The shared filter state; the calendar re-reads when it changes. */
  readonly filters = input.required<InterviewListQuery>();
  /** D-045: the open schedule by default. The calendar never forces this on. */
  readonly includeFinished = input.required<boolean>();

  readonly opened = output<InterviewListItem>();

  readonly rows = signal<InterviewListItem[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /**
   * Set when the visible window holds more interviews than we were willing to
   * fetch. Never left silent — see `fetchWindow`.
   */
  readonly truncatedAt = signal<number | null>(null);
  readonly windowTotal = signal(0);

  /**
   * `MAX_INTERVIEW_LIMIT` is 100 server-side, so one request cannot fill a busy
   * month. We page until the window is exhausted, up to this many requests.
   * Beyond it the calendar SAYS it is truncating rather than drawing a partial
   * month that looks complete.
   */
  private static readonly PAGE = 100;
  private static readonly MAX_PAGES = 10;

  private currentStart: Date | null = null;
  private currentEnd: Date | null = null;

  readonly events = computed<EventInput[]>(() =>
    this.rows().map((row) => {
      const start = new Date(row.scheduledAt);
      // D-005's conflict window, used as the DISPLAYED duration (D-094/D-096).
      // The model stores no duration; this is presentation only, and 30 minutes
      // is the exact span the server refuses to double-book, so the block a
      // reader sees is the block the server reasons about.
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const cancelled = row.status === 'Annulé';

      return {
        id: row.id,
        title: row.candidate?.fullName ?? 'Candidat inconnu',
        start,
        end,
        classNames: [`iv--${cancelled ? 'cancelled' : row.status === 'Réalisé' ? 'done' : 'planned'}`],
        extendedProps: { row },
      };
    }),
  );

  readonly options = computed<CalendarOptions>(() => ({
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin],
    initialView: 'timeGridWeek',
    locale: frLocale,
    height: 'auto',
    nowIndicator: true,
    slotMinTime: '07:00:00',
    slotMaxTime: '20:00:00',
    expandRows: true,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
    },
    buttonText: { today: "Aujourd'hui", month: 'Mois', week: 'Semaine', day: 'Jour', list: 'Agenda' },
    noEventsText: 'Aucun entretien sur cette période.',

    // See the class docblock: there is no route to persist a move to.
    editable: false,
    selectable: false,

    // Overlaps render side by side — this is what makes an FR-31 clash visible
    // BEFORE a recruiter proposes the slot rather than after the server refuses.
    slotEventOverlap: true,

    events: this.events(),
    eventClick: (arg: EventClickArg) => {
      const row = arg.event.extendedProps['row'] as InterviewListItem | undefined;
      if (row) {
        this.opened.emit(row);
      }
    },
    datesSet: (arg: DatesSetArg) => this.onWindowChanged(arg.start, arg.end),
  }));

  /** Re-read when the visible range changes, and when the filters do. */
  private onWindowChanged(start: Date, end: Date): void {
    this.currentStart = start;
    this.currentEnd = end;
    this.fetchWindow();
  }

  constructor() {
    // The window is not the only thing that invalidates the data: the SHARED
    // filters and D-045's includeFinished toggle live on the parent, and
    // changing either must re-read. Without this the calendar kept showing the
    // previous answer while the list beside it updated — caught live, not in a
    // unit test, because both views have to be on screen to notice.
    //
    // On the first run `currentStart` is still null (FullCalendar has not
    // reported a window yet) and `fetchWindow` returns early, so this does not
    // duplicate the initial `datesSet` fetch.
    effect(() => {
      this.filters();
      this.includeFinished();
      this.fetchWindow();
    });
  }

  private fetchWindow(): void {
    if (!this.currentStart || !this.currentEnd) {
      return;
    }

    const from = this.currentStart;
    const to = this.currentEnd;

    this.loading.set(true);
    this.errorMessage.set(null);
    this.truncatedAt.set(null);

    const collected: InterviewListItem[] = [];

    const readPage = (offset: number, page: number): void => {
      this.interviews
        .listInterviews({
          ...this.filters(),
          includeFinished: this.includeFinished() || undefined,
          fromDate: from.toISOString(),
          toDate: to.toISOString(),
          limit: InterviewCalendar.PAGE,
          offset,
          sortBy: 'scheduledAt',
          sortDir: 'asc',
        })
        .subscribe({
          next: (result) => {
            collected.push(...result.items);
            this.windowTotal.set(result.total);

            const more = collected.length < result.total && result.items.length > 0;
            if (more && page < InterviewCalendar.MAX_PAGES) {
              readPage(offset + InterviewCalendar.PAGE, page + 1);
              return;
            }

            // If we stopped early, SAY SO. A month grid that quietly drops
            // rows is the failure mode a calendar makes hardest to notice.
            if (more) {
              this.truncatedAt.set(collected.length);
            }
            this.rows.set(collected);
            this.loading.set(false);
          },
          error: (response: HttpErrorResponse) => {
            this.loading.set(false);
            this.rows.set([]);
            const body = response.error as ApiError | null;
            this.errorMessage.set(
              body?.error?.message ??
                (response.status === 0
                  ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                  : "Le calendrier n'a pas pu être chargé. Réessayez."),
            );
          },
        });
    };

    readPage(0, 1);
  }
}

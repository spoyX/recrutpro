import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../core/auth.service';
import {
  NotificationService,
  AppNotification,
  NOTIFICATION_PAGE_SIZE,
} from '../../core/notification.service';

/**
 * FR-43 / FR-44 and user story 33's unread badge.
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE — the **sixth page running**, and the
 * **eleventh** time the check has said no. `GET /notifications`,
 * `PATCH /:id/read` and `DELETE /:id` have all existed since 2026-08-10
 * (D-054, D-055), and until now **nothing in the frontend called any of them**:
 * every notification the system had written was unreadable by its recipient.
 * D-078's whole-spec audit is what found it.
 *
 * IN THE TOPBAR, not on a route. The badge has to be visible from wherever the
 * user is standing, which means it belongs to the chrome — and `app-shell` is
 * the one component every protected page already wraps itself in (D-067,
 * D-070). A `/notifications` route would put the badge nowhere.
 *
 * *** THE COUNT REFRESHES ON EVERY NAVIGATION, FOR FREE. *** Each page renders
 * its own `<app-shell>`, so this component is destroyed and rebuilt on every
 * route change and asks for the count again. There is deliberately **no
 * polling timer**: nothing in FR-43, FR-44 or user story 33 asks for live
 * updates, and a background interval is a speculative feature with a real cost
 * (a request every N seconds per open tab, forever).
 *
 * *** MUTATIONS ARE APPLIED FROM THE SERVER'S OWN ANSWER, NOT REFETCHED. ***
 * `markRead` returns the updated notification and `remove` returns 204, so the
 * row is patched or dropped in place. That is not just cheaper — refetching
 * after a delete would re-page a list whose offsets have all shifted by one,
 * which is how a paged list silently skips a row.
 */
@Component({
  selector: 'app-notification-panel',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  templateUrl: './notification-panel.html',
  styleUrl: './notification-panel.scss',
})
export class NotificationPanel {
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly pageSize = NOTIFICATION_PAGE_SIZE;

  readonly open = signal(false);
  readonly rows = signal<AppNotification[]>([]);
  readonly total = signal(0);
  readonly unread = signal(0);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** Ids currently being mutated, so one row's spinner is not every row's. */
  readonly busyIds = signal<ReadonlySet<string>>(new Set());

  readonly hasMore = computed(() => this.rows().length < this.total());

  constructor() {
    this.loadUnreadCount();
  }

  /**
   * The badge. Its own tiny request (`limit=1`), rather than a side effect of
   * loading the list: the badge must be right on a page where the panel was
   * never opened, which is most of them.
   */
  private loadUnreadCount(): void {
    this.notifications.unreadCount().subscribe({
      next: (count) => this.unread.set(count),
      // A failed badge must never break the chrome it sits in. 401 is handled
      // by whichever page request also gets one — bouncing to /login from the
      // shell would fight that navigation.
      error: () => this.unread.set(0),
    });
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.load();
    }
  }

  close(): void {
    this.open.set(false);
  }

  /** FR-43 — the first page, newest first. */
  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.notifications.list(0).subscribe({
      next: (page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.loading.set(false);
        // Re-derived from what actually came back rather than trusted from the
        // badge request, which may be seconds old by the time the panel opens.
        this.loadUnreadCount();
      },
      error: (response: HttpErrorResponse) => this.fail(response),
    });
  }

  /**
   * FR-44 forbids expiry, so this list has no natural ceiling. Pages are
   * APPENDED and the header states « X sur N », so the panel never implies it
   * is showing everything when it is not.
   */
  loadMore(): void {
    if (this.loading() || !this.hasMore()) {
      return;
    }
    this.loading.set(true);

    this.notifications.list(this.rows().length).subscribe({
      next: (page) => {
        this.rows.update((current) => [...current, ...page.items]);
        this.total.set(page.total);
        this.loading.set(false);
      },
      error: (response: HttpErrorResponse) => this.fail(response),
    });
  }

  /** FR-43 — mark one as read. Already-read rows are not offered the action. */
  markRead(notification: AppNotification): void {
    if (notification.isRead || this.isBusy(notification.id)) {
      return;
    }

    this.setBusy(notification.id, true);
    this.errorMessage.set(null);

    this.notifications.markRead(notification.id).subscribe({
      next: (updated) => {
        this.setBusy(notification.id, false);
        // The SERVER's row replaces ours — `isRead` is its answer, not our
        // assumption about what the call did.
        this.rows.update((current) => current.map((n) => (n.id === updated.id ? updated : n)));
        this.unread.update((n) => Math.max(0, n - 1));
      },
      error: (response: HttpErrorResponse) => {
        this.setBusy(notification.id, false);
        this.fail(response);
      },
    });
  }

  /** FR-44 — delete. The only way a notification ever leaves the system. */
  remove(notification: AppNotification): void {
    if (this.isBusy(notification.id)) {
      return;
    }

    this.setBusy(notification.id, true);
    this.errorMessage.set(null);

    this.notifications.remove(notification.id).subscribe({
      next: () => {
        this.setBusy(notification.id, false);
        this.rows.update((current) => current.filter((n) => n.id !== notification.id));
        this.total.update((n) => Math.max(0, n - 1));
        // Only if it WAS unread — decrementing unconditionally would drift the
        // badge below the truth every time a read notification is deleted.
        if (!notification.isRead) {
          this.unread.update((n) => Math.max(0, n - 1));
        }
      },
      error: (response: HttpErrorResponse) => {
        this.setBusy(notification.id, false);
        this.fail(response);
      },
    });
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update((current) => {
      const next = new Set(current);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  }

  private fail(response: HttpErrorResponse): void {
    this.loading.set(false);

    // FR-2 expiry or FR-8 deactivation — signing in again is the only useful
    // action. Unlike the badge request, this one was user-initiated, so a
    // navigation is the right answer rather than a silent zero.
    if (response.status === 401) {
      void this.router.navigate(['/login']);
      return;
    }

    const body = response.error as ApiError | null;
    this.errorMessage.set(
      body?.error?.message ??
        (response.status === 0
          ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
          : 'Vos notifications sont momentanément indisponibles. Réessayez.'),
    );
  }

  /**
   * One icon per `NotificationType`. The MESSAGE is the server's and is never
   * rewritten here — FR-40 to FR-42 compose it, and a second copy in the client
   * would drift from the one in the database.
   */
  icon(type: AppNotification['type']): string {
    switch (type) {
      case 'EntretienPlanifie':
        return 'event_available';
      case 'EvaluationSoumise':
        return 'fact_check';
      default:
        return 'timeline';
    }
  }
}

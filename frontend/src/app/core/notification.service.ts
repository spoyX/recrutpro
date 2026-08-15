import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * FR-43 / FR-44 — the notification panel's data.
 *
 * In `core/`, not `features/`: the bell lives in the application chrome and is
 * reachable from every page, like `AuthService`.
 *
 * Mirrors the backend's `PublicNotification`. Note what is NOT here: `userId`.
 * D-054 scopes every query to the session, so every notification a caller can
 * reach is theirs by construction and the recipient is deliberately not echoed
 * back.
 */
export interface AppNotification {
  id: string;
  type: 'ChangementEtape' | 'EvaluationSoumise' | 'EntretienPlanifie';
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  /** From `X-Total-Count` — the total BEFORE pagination. */
  total: number;
}

/** The server's own default; stated here so the panel can page by the same step. */
export const NOTIFICATION_PAGE_SIZE = 25;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/notifications`;

  /**
   * FR-43 — one page, newest first.
   *
   * PAGINATED for a reason particular to this module: FR-44 forbids any expiry,
   * so a user's notifications grow without bound for the life of the account.
   * Every other list in this app is bounded by the business; this one is not.
   */
  list(offset = 0, isRead?: boolean): Observable<NotificationPage> {
    const params: Record<string, string> = {
      limit: String(NOTIFICATION_PAGE_SIZE),
      offset: String(offset),
    };
    if (isRead !== undefined) {
      params['isRead'] = String(isRead);
    }

    return this.http
      .get<AppNotification[]>(this.url, {
        params,
        observe: 'response',
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(
        map((response) => ({
          items: response.body ?? [],
          total: Number(response.headers.get('X-Total-Count') ?? 0),
        })),
      );
  }

  /**
   * User story 33's unread badge. No second endpoint: `isRead=false` with
   * `limit=1` answers the count in `X-Total-Count` without shipping rows the
   * badge would throw away.
   */
  unreadCount(): Observable<number> {
    return this.http
      .get<AppNotification[]>(this.url, {
        params: { isRead: 'false', limit: '1' },
        observe: 'response',
        withCredentials: true,
      })
      .pipe(map((response) => Number(response.headers.get('X-Total-Count') ?? 0)));
  }

  /** FR-43 — idempotent server-side: re-marking a read one is a 200, not a 409. */
  markRead(id: string): Observable<AppNotification> {
    return this.http.patch<AppNotification>(
      `${this.url}/${encodeURIComponent(id)}/read`,
      {},
      { withCredentials: true },
    );
  }

  /**
   * FR-44 — manual deletion, the only way a notification ever leaves the system.
   *
   * NOT idempotent: a second delete is a 404, the same answer as deleting
   * someone else's. D-054 makes "not yours" and "not there" indistinguishable
   * on purpose, so the panel must not translate a 404 into "already gone".
   */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, {
      withCredentials: true,
    });
  }
}

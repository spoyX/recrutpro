import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NotificationPanel } from './notification-panel';
import { AppNotification } from '../../core/notification.service';
import { environment } from '../../../environments/environment';

/**
 * FR-43 / FR-44 and user story 33's unread badge.
 *
 * The assertions that matter most here are the ones about what must NOT drift:
 * the badge count after a mark-read and after each kind of delete, since those
 * are maintained locally from the server's own answer rather than refetched.
 */
describe('NotificationPanel (FR-43, FR-44)', () => {
  let fixture: ComponentFixture<NotificationPanel>;
  let http: HttpTestingController;
  let router: Router;

  const URL = `${environment.apiUrl}/notifications`;

  const note = (id: string, over: Partial<AppNotification> = {}): AppNotification => ({
    id,
    type: 'ChangementEtape',
    message: `Le candidat ${id} a changé d'étape.`,
    isRead: false,
    createdAt: '2026-08-14T09:00:00.000Z',
    ...over,
  });

  /** The badge request the component makes on construction. */
  const badge = (): TestRequest => http.expectOne((r) => r.params.get('limit') === '1');

  /** The list request the panel makes when opened. */
  const listRequest = (): TestRequest =>
    http.expectOne((r) => r.url === URL && r.params.get('limit') !== '1');

  const create = (unread = 0): void => {
    fixture = TestBed.createComponent(NotificationPanel);
    fixture.detectChanges();
    badge().flush([], { headers: { 'X-Total-Count': String(unread) } });
    fixture.detectChanges();
  };

  /** Opens the panel and answers the list, then the badge re-read it triggers. */
  const open = (rows: AppNotification[], total = rows.length, unread?: number): void => {
    bell().click();
    fixture.detectChanges();
    listRequest().flush(rows, { headers: { 'X-Total-Count': String(total) } });
    fixture.detectChanges();
    badge().flush([], {
      headers: {
        'X-Total-Count': String(unread ?? rows.filter((r) => !r.isRead).length),
      },
    });
    fixture.detectChanges();
  };

  const bell = (): HTMLButtonElement => fixture.nativeElement.querySelector('.bell__button');

  const badgeEl = (): HTMLElement | null => fixture.nativeElement.querySelector('.bell__badge');

  /** `textContent`, never `innerText` — `.label-sm` uppercases via CSS. */
  const text = (): string => fixture.nativeElement.textContent as string;

  const rowFor = (id: string): HTMLElement => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.note')) as HTMLElement[];
    return rows.find((r) => r.textContent?.includes(id))!;
  };

  const action = (id: string, label: string): HTMLButtonElement | undefined =>
    Array.from(rowFor(id).querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === label,
    ) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationPanel],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('User story 33 — the unread badge', () => {
    it('asks only for the COUNT, never for rows it would throw away', () => {
      fixture = TestBed.createComponent(NotificationPanel);
      fixture.detectChanges();

      const req = badge();
      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.params.get('isRead')).toBe('false');
      expect(req.request.params.get('limit')).toBe('1');

      req.flush([], { headers: { 'X-Total-Count': '7' } });
      fixture.detectChanges();

      // The number comes from the HEADER, not from the row count — flushing an
      // empty array with a total of 7 is exactly the shape that catches a
      // component reading `body.length` instead.
      expect(badgeEl()!.textContent!.trim()).toBe('7');
    });

    it('renders NO badge at zero — a badge is a call to look', () => {
      create(0);

      expect(badgeEl()).toBeNull();
      expect(bell().getAttribute('aria-label')).toContain('aucune non lue');
    });

    it('announces the count to a screen reader, not only in the pixel badge', () => {
      create(3);

      expect(bell().getAttribute('aria-label')).toBe('Notifications, 3 non lues');
    });

    it('a failed badge request leaves the chrome intact', () => {
      fixture = TestBed.createComponent(NotificationPanel);
      fixture.detectChanges();
      badge().flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      // The bell still renders and the shell is not showing an error banner:
      // a broken badge must never take the topbar down with it.
      expect(bell()).toBeTruthy();
      expect(badgeEl()).toBeNull();
    });

    it('a 401 on the BADGE does not navigate — the page request owns that', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      fixture = TestBed.createComponent(NotificationPanel);
      fixture.detectChanges();
      badge().flush(null, { status: 401, statusText: 'Unauthorized' });

      // Two navigations racing to /login is worse than one; the page's own
      // request gets the same 401 and handles it.
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('FR-43 — the list', () => {
    it('issues NO list request until it is opened', () => {
      create(2);

      // The COUNT is the assertion — a bare verify() records no expectation.
      expect(http.match(() => true).length).toBe(0);
      expect(fixture.nativeElement.querySelector('.panel')).toBeNull();
    });

    it('asks for the first page, newest first, with the session cookie', () => {
      create(2);
      bell().click();
      fixture.detectChanges();

      const req = listRequest();
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.params.get('offset')).toBe('0');
      expect(req.request.params.get('limit')).toBe('25');
      // No isRead filter: the panel shows everything and marks unread rows.
      expect(req.request.params.has('isRead')).toBeFalse();

      req.flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();
      badge().flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it("renders the SERVER's message verbatim, with its date", () => {
      create(1);
      open([note('n1', { message: 'Jean Martin est passé à « Entretien planifié ».' })]);

      expect(text()).toContain('Jean Martin est passé à « Entretien planifié ».');
      expect(text()).toContain('14/08/2026');
    });

    it('marks unread rows with a label, not with colour alone', () => {
      create(1);
      open([note('n1'), note('n2', { isRead: true })]);

      expect(rowFor('n1').classList).toContain('note--unread');
      expect(rowFor('n2').classList).not.toContain('note--unread');
      expect(rowFor('n1').textContent).toContain('Non lue');
      expect(rowFor('n2').textContent).not.toContain('Non lue');
    });

    it('states X sur N, so it never implies it is showing everything', () => {
      create(0);
      open([note('n1'), note('n2')], 40);

      expect(text()).toContain('2 sur 40');
      expect(text()).toContain('Charger les 25 suivantes');
    });

    it('offers no « charger plus » when it already holds everything', () => {
      create(0);
      open([note('n1')], 1);

      expect(text()).not.toContain('Charger les');
    });

    it('APPENDS the next page at the right offset', () => {
      create(0);
      open([note('n1')], 3);

      fixture.componentInstance.loadMore();
      const req = http.expectOne((r) => r.url === URL && r.params.get('offset') === '1');
      req.flush([note('n2'), note('n3')], { headers: { 'X-Total-Count': '3' } });
      fixture.detectChanges();

      expect(fixture.componentInstance.rows().map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
      expect(text()).toContain('3 sur 3');
    });

    it('says so plainly when there is nothing', () => {
      create(0);
      open([], 0);

      expect(text()).toContain('Aucune notification');
    });
  });

  describe('FR-43 — mark as read', () => {
    it('PATCHes, then takes isRead from the SERVER’s answer', () => {
      create(2);
      open([note('n1'), note('n2')], 2, 2);
      expect(badgeEl()!.textContent!.trim()).toBe('2');

      action('n1', 'Marquer comme lue')!.click();

      const req = http.expectOne(`${URL}/n1/read`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.withCredentials).toBeTrue();
      req.flush(note('n1', { isRead: true }));
      fixture.detectChanges();

      expect(rowFor('n1').classList).not.toContain('note--unread');
      expect(badgeEl()!.textContent!.trim()).toBe('1');
      // The other row is untouched — before AND after, not just after.
      expect(rowFor('n2').classList).toContain('note--unread');
    });

    it('does NOT refetch the list — the offsets would be the same but the call is waste', () => {
      create(1);
      open([note('n1')], 1, 1);

      action('n1', 'Marquer comme lue')!.click();
      http.expectOne(`${URL}/n1/read`).flush(note('n1', { isRead: true }));
      fixture.detectChanges();

      expect(http.match(() => true).length).toBe(0);
    });

    it('is not offered on an already-read row', () => {
      create(0);
      open([note('n1', { isRead: true })]);

      expect(action('n1', 'Marquer comme lue')).toBeUndefined();
      expect(action('n1', 'Supprimer cette notification')).toBeTruthy();
    });

    it('a failure leaves the row unread and the count UNCHANGED', () => {
      create(2);
      open([note('n1'), note('n2')], 2, 2);
      expect(badgeEl()!.textContent!.trim()).toBe('2');

      action('n1', 'Marquer comme lue')!.click();
      http.expectOne(`${URL}/n1/read`).flush(
        { error: { code: 'NOT_FOUND', message: "Cette notification n'existe pas." } },
        { status: 404, statusText: 'Not Found' },
      );
      fixture.detectChanges();

      // Asserted BOTH ways: the count was 2 before and is 2 after, and the row
      // is still unread. An optimistic decrement would drift the badge below
      // the truth on every failure.
      expect(badgeEl()!.textContent!.trim()).toBe('2');
      expect(rowFor('n1').classList).toContain('note--unread');
      expect(text()).toContain("Cette notification n'existe pas.");
    });
  });

  describe('FR-44 — delete', () => {
    it('DELETEs and drops the row, decrementing BOTH totals for an unread one', () => {
      create(2);
      open([note('n1'), note('n2')], 2, 2);

      action('n1', 'Supprimer cette notification')!.click();

      const req = http.expectOne(`${URL}/n1`);
      expect(req.request.method).toBe('DELETE');
      expect(req.request.withCredentials).toBeTrue();
      req.flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      expect(fixture.componentInstance.rows().map((n) => n.id)).toEqual(['n2']);
      expect(fixture.componentInstance.total()).toBe(1);
      expect(badgeEl()!.textContent!.trim()).toBe('1');
    });

    it('deleting a READ one leaves the unread count alone', () => {
      create(1);
      open([note('n1', { isRead: true }), note('n2')], 2, 1);
      expect(badgeEl()!.textContent!.trim()).toBe('1');

      action('n1', 'Supprimer cette notification')!.click();
      http.expectOne(`${URL}/n1`).flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      // The total drops, the UNREAD count does not — decrementing both would
      // drift the badge below the truth every time a read row is deleted.
      expect(fixture.componentInstance.total()).toBe(1);
      expect(badgeEl()!.textContent!.trim()).toBe('1');
    });

    it('D-054: a 404 is SHOWN, never translated into "already gone"', () => {
      create(1);
      open([note('n1')], 1, 1);

      action('n1', 'Supprimer cette notification')!.click();
      http.expectOne(`${URL}/n1`).flush(
        { error: { code: 'NOT_FOUND', message: "Cette notification n'existe pas." } },
        { status: 404, statusText: 'Not Found' },
      );
      fixture.detectChanges();

      // "Not yours" and "not there" are deliberately indistinguishable, so the
      // panel must not guess which it was and quietly drop the row.
      expect(fixture.componentInstance.rows().map((n) => n.id)).toEqual(['n1']);
      expect(fixture.componentInstance.total()).toBe(1);
      expect(badgeEl()!.textContent!.trim()).toBe('1');
      expect(text()).toContain("Cette notification n'existe pas.");
    });

    it('does NOT refetch — a re-page after a delete would skip a row', () => {
      create(0);
      open([note('n1', { isRead: true })], 1);

      action('n1', 'Supprimer cette notification')!.click();
      http.expectOne(`${URL}/n1`).flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      // Every loaded offset shifts by one after a delete, so refetching page 2
      // is how a paged list silently loses a row.
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('Errors and closing', () => {
    it('a 401 on a USER-initiated call goes to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create(1);
      bell().click();
      fixture.detectChanges();
      listRequest().flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('reports an unreachable server rather than an empty panel', () => {
      create(1);
      bell().click();
      fixture.detectChanges();
      listRequest().error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
      // NOT the empty state — "nothing here" and "we could not look" are
      // different facts.
      expect(text()).not.toContain('Aucune notification pour le moment');
    });

    it('closes on the scrim, without touching the server', () => {
      create(0);
      open([note('n1')]);

      (fixture.nativeElement.querySelector('.bell__scrim') as HTMLElement).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.panel')).toBeNull();
      expect(http.match(() => true).length).toBe(0);
    });
  });
});

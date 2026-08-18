import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { CandidatesList } from './candidates-list';
import { CandidateListItem } from '../candidate.service';
import { environment } from '../../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../../testing/shell-requests';

describe('CandidatesList (FR-24)', () => {
  let fixture: ComponentFixture<CandidatesList>;
  let http: HttpTestingController;
  let router: Router;

  const URL = `${environment.apiUrl}/candidates`;
  const POSITIONS_URL = `${environment.apiUrl}/job-positions`;

  const row = (id: string, overrides: Partial<CandidateListItem> = {}): CandidateListItem => ({
    id,
    fullName: `Candidat ${id}`,
    email: `${id}@example.com`,
    phone: '0612345678',
    jobPosition: { id: 'p1', title: 'Développeur backend' },
    currentStage: 'Candidature reçue',
    registeredAt: '2026-08-01T09:00:00.000Z',
    hasResume: true,
    ...overrides,
  });

  /**
   * A realistic FULL page. The server returns `limit` rows whenever that many
   * match, so a fixture with 1 row and a total of 60 describes a response the
   * API cannot produce — and any range assertion built on it is testing
   * fiction.
   */
  const fullPage = (prefix: string): CandidateListItem[] =>
    Array.from({ length: 25 }, (_, i) => row(`${prefix}${i}`));

  const create = (): void => {
    fixture = TestBed.createComponent(CandidatesList);
    fixture.detectChanges();
  };

  /** The list request, ignoring the independent job-positions call. */
  const listRequest = (): TestRequest => {
    const matches = http.match((r) => r.url === URL);
    expect(matches.length).toBe(1);
    return matches[0];
  };

  const flushPositions = (): void => {
    const reqs = http.match((r) => r.url === POSITIONS_URL);
    reqs.forEach((r) => r.flush([{ id: 'p1', title: 'Développeur backend', status: 'Ouvert' }]));
  };

  const load = (rows: CandidateListItem[] = [row('a'), row('b')], total = 2): void => {
    create();
    listRequest().flush(rows, { headers: { 'X-Total-Count': String(total) } });
    flushPositions();
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidatesList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    // The topbar badge (D-081) fires on every shell render. Drained narrowly,
    // so a stray request of any OTHER url still fails the spec.
    drainShellRequests(http);
    expectNoPageRequests(http);
  });

  describe('D-041 — the list contract', () => {
    it('D-001: requests candidates with credentials', () => {
      create();
      const req = listRequest();

      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.method).toBe('GET');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
      flushPositions();
    });

    it('reads the match count from X-Total-Count, not the body length', () => {
      // 2 rows on the page, 57 matches overall — the header is the only place
      // that number exists.
      load([row('a'), row('b')], 57);

      expect(fixture.componentInstance.total()).toBe(57);
      expect(text()).toContain('Affichage de 1 à 2 sur 57');
    });

    it('falls back to the page length when the header is missing', () => {
      create();
      listRequest().flush([row('a'), row('b')]);
      flushPositions();
      fixture.detectChanges();

      expect(fixture.componentInstance.total()).toBe(2);
    });

    it('sends the D-041 page size and the default sort', () => {
      create();
      const req = listRequest();

      expect(req.request.params.get('limit')).toBe('25');
      expect(req.request.params.get('offset')).toBe('0');
      expect(req.request.params.get('sortBy')).toBe('registeredAt');
      expect(req.request.params.get('sortDir')).toBe('desc');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
      flushPositions();
    });

    it('sends NO empty filter params — an empty value is a 400, never an ignored filter', () => {
      create();
      const req = listRequest();

      expect(req.request.params.has('currentStage')).toBeFalse();
      expect(req.request.params.has('jobPositionId')).toBeFalse();
      expect(req.request.params.has('fromDate')).toBeFalse();
      expect(req.request.params.has('toDate')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
      flushPositions();
    });
  });

  describe('FR-24 — the rendered row', () => {
    it('renders name, contact, poste and registration date', () => {
      load([row('a', { fullName: 'Jean Martin', email: 'jean@example.com' })], 1);

      expect(text()).toContain('Jean Martin');
      expect(text()).toContain('jean@example.com');
      expect(text()).toContain('0612345678');
      expect(text()).toContain('Développeur backend');
      expect(text()).toContain('01/08/2026');
    });

    it('renders the stage through the shared StageChip', () => {
      load([row('a', { currentStage: 'Accepté' })], 1);

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip');
      expect(chip).toBeTruthy();
      // textContent, NOT innerText: the chip is uppercased by CSS, so
      // innerText would report « ACCEPTÉ » and a source-cased compare fails.
      expect(chip.textContent.trim()).toBe('Accepté');
      expect(chip.classList).toContain('chip--positive');
    });

    it('links each name into the candidate file (D-067)', () => {
      load([row('abc123')], 1);

      const link = fixture.nativeElement.querySelector('.table__link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/candidates/abc123');
    });

    it('distinguishes a candidate with a CV from one without', () => {
      load([row('a', { hasResume: true }), row('b', { hasResume: false })], 2);

      expect(fixture.nativeElement.querySelectorAll('.table__cv--yes').length).toBe(1);
      expect(fixture.nativeElement.querySelectorAll('.table__cv--no').length).toBe(1);
    });

    it('survives a row whose position was not resolved', () => {
      load([row('a', { jobPosition: null })], 1);

      expect(text()).toContain('Poste inconnu');
    });
  });

  describe('FR-24 — filters', () => {
    it('sends the stage filter and resets to the first page', () => {
      load(fullPage('a'), 60);
      fixture.componentInstance.nextPage();
      listRequest().flush(fullPage('b'), { headers: { 'X-Total-Count': '60' } });
      fixture.detectChanges();
      expect(fixture.componentInstance.offset()).toBe(25);

      fixture.componentInstance.setFilter('currentStage', 'Accepté');
      const req = listRequest();

      expect(req.request.params.get('currentStage')).toBe('Accepté');
      // Page 3 of a different filter is meaningless.
      expect(req.request.params.get('offset')).toBe('0');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('sends the poste and date-range filters', () => {
      load();

      fixture.componentInstance.setFilter('jobPositionId', 'p1');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.componentInstance.setFilter('fromDate', '2026-08-01');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.componentInstance.setFilter('toDate', '2026-08-31');
      const req = listRequest();

      expect(req.request.params.get('jobPositionId')).toBe('p1');
      expect(req.request.params.get('fromDate')).toBe('2026-08-01');
      expect(req.request.params.get('toDate')).toBe('2026-08-31');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('clearing a filter DROPS the param rather than sending an empty one', () => {
      load();
      fixture.componentInstance.setFilter('currentStage', 'Accepté');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });

      fixture.componentInstance.setFilter('currentStage', '');
      const req = listRequest();

      expect(req.request.params.has('currentStage')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('distinguishes "no candidates yet" from "none match the filter"', () => {
      load([], 0);
      expect(text()).toContain("Aucun candidat n'est enregistré pour le moment.");

      fixture.componentInstance.setFilter('currentStage', 'Accepté');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('Aucun candidat ne correspond à ces filtres.');
    });

    it('resets every filter at once', () => {
      load();
      fixture.componentInstance.setFilter('currentStage', 'Accepté');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.componentInstance.setFilter('jobPositionId', 'p1');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });

      fixture.componentInstance.resetFilters();
      const req = listRequest();

      expect(req.request.params.has('currentStage')).toBeFalse();
      expect(req.request.params.has('jobPositionId')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });
  });

  describe('D-041 — sorting', () => {
    it('a new column sorts descending first', () => {
      load();

      fixture.componentInstance.sort('fullName');
      const req = listRequest();

      expect(req.request.params.get('sortBy')).toBe('fullName');
      expect(req.request.params.get('sortDir')).toBe('desc');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('clicking the active column flips the direction', () => {
      load();
      fixture.componentInstance.sort('fullName');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });

      fixture.componentInstance.sort('fullName');
      const req = listRequest();

      expect(req.request.params.get('sortDir')).toBe('asc');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('exposes aria-sort on the sorted column only', () => {
      load();

      expect(fixture.componentInstance.ariaSort('registeredAt')).toBe('descending');
      expect(fixture.componentInstance.ariaSort('fullName')).toBeNull();
    });
  });

  describe('D-041 — pagination', () => {
    it('advances by the page size and reports the range', () => {
      load(fullPage('a'), 60);
      expect(text()).toContain('Affichage de 1 à 25 sur 60');

      fixture.componentInstance.nextPage();
      const req = listRequest();
      expect(req.request.params.get('offset')).toBe('25');
      req.flush(fullPage('b'), { headers: { 'X-Total-Count': '60' } });
      fixture.detectChanges();

      expect(text()).toContain('Affichage de 26 à 50 sur 60');
    });

    it('the LAST page reports the rows it actually holds, not a full page', () => {
      // 60 matches, 25 per page: the third page holds 10.
      load(fullPage('a'), 60);
      fixture.componentInstance.nextPage();
      listRequest().flush(fullPage('b'), { headers: { 'X-Total-Count': '60' } });
      fixture.componentInstance.nextPage();
      listRequest().flush(
        Array.from({ length: 10 }, (_, i) => row(`c${i}`)),
        { headers: { 'X-Total-Count': '60' } },
      );
      fixture.detectChanges();

      expect(text()).toContain('Affichage de 51 à 60 sur 60');
      expect(fixture.componentInstance.hasNext()).toBeFalse();
    });

    it('does not page past the end or before the start', () => {
      load([row('a'), row('b')], 2);

      expect(fixture.componentInstance.hasNext()).toBeFalse();
      expect(fixture.componentInstance.hasPrevious()).toBeFalse();
      // Both are no-ops, so no request is made and http.verify() stays happy.
      fixture.componentInstance.nextPage();
      fixture.componentInstance.previousPage();
    });

    it('reports an empty range as 0, not 1–0', () => {
      load([], 0);

      expect(fixture.componentInstance.rangeStart()).toBe(0);
      expect(text()).toContain('Aucun candidat');
    });
  });

  describe('Errors', () => {
    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      listRequest().flush(null, { status: 401, statusText: 'Unauthorized' });
      flushPositions();
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it("NFR-09: a 403 shows the server's own message, without redirecting", () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      listRequest().flush(
        { error: { code: 'FORBIDDEN', message: 'Votre rôle ne permet pas cette action.' } },
        { status: 403, statusText: 'Forbidden' },
      );
      flushPositions();
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(text()).toContain('Votre rôle ne permet pas cette action.');
    });

    it('D-041: surfaces the server message when a bound is refused rather than clamped', () => {
      create();
      listRequest().flush(
        { error: { code: 'VALIDATION_ERROR', message: '« limit » doit être compris entre 1 et 100.' } },
        { status: 400, statusText: 'Bad Request' },
      );
      flushPositions();
      fixture.detectChanges();

      expect(text()).toContain('« limit » doit être compris entre 1 et 100.');
    });

    it('a failed job-positions call does NOT break the list', () => {
      create();
      listRequest().flush([row('a')], { headers: { 'X-Total-Count': '1' } });
      http.match((r) => r.url === POSITIONS_URL).forEach((r) =>
        r.flush(null, { status: 500, statusText: 'Server Error' }),
      );
      fixture.detectChanges();

      expect(text()).toContain('Candidat a');
      expect(fixture.componentInstance.positionOptions()).toEqual([]);
    });
  });
});

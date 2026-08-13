import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { InterviewsList } from './interviews-list';
import { InterviewListItem } from '../interview.service';
import { AuthService, AuthenticatedUser } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

describe('InterviewsList (FR-33, FR-34, FR-35)', () => {
  let fixture: ComponentFixture<InterviewsList>;
  let http: HttpTestingController;
  let router: Router;

  const URL = `${environment.apiUrl}/interviews`;

  const row = (id: string, overrides: Partial<InterviewListItem> = {}): InterviewListItem => ({
    id,
    scheduledAt: '2026-09-10T09:00:00.000Z',
    status: 'Planifié',
    candidate: {
      id: `c-${id}`,
      fullName: `Candidat ${id}`,
      hasResume: true,
      resumeUrl: `/api/v1/candidates/c-${id}/resume`,
    },
    jobPosition: { id: 'p1', title: 'Développeur backend' },
    interviewer: { id: 'u2', name: 'Pierre Blanc' },
    cancellationReason: null,
    ...overrides,
  });

  const signIn = (role: AuthenticatedUser['role']): void => {
    TestBed.inject(AuthService).currentUser.set({
      id: 'u1',
      name: 'Marie',
      email: 'marie@example.com',
      role,
      departmentId: 'd1',
      mustChangePassword: false,
    });
  };

  const create = (): void => {
    fixture = TestBed.createComponent(InterviewsList);
    fixture.detectChanges();
  };

  const listRequest = (): TestRequest => {
    const matches = http.match((r) => r.url === URL);
    expect(matches.length).toBe(1);
    return matches[0];
  };

  const load = (rows: InterviewListItem[] = [row('a')], total = 1): void => {
    create();
    listRequest().flush(rows, { headers: { 'X-Total-Count': String(total) } });
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  /**
   * The LOCAL HH:mm an ISO instant renders as. Interviews are stored in UTC and
   * shown in the viewer's timezone, which is correct — so a hard-coded '09:00'
   * would only pass in UTC and fail everywhere the app is actually used.
   */
  const localTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InterviewsList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('D-045 / D-049 — the list contract', () => {
    it('D-001: requests with credentials', () => {
      create();
      const req = listRequest();

      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBeTrue();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('a schedule reads FORWARD by default, unlike the candidate list', () => {
      create();
      const req = listRequest();

      expect(req.request.params.get('sortBy')).toBe('scheduledAt');
      expect(req.request.params.get('sortDir')).toBe('asc');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('D-049: hides finished and cancelled by default — the param is omitted', () => {
      create();
      const req = listRequest();

      expect(req.request.params.has('includeFinished')).toBeFalse();
      expect(req.request.params.has('includeCancelled')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('D-049: the toggle sends includeFinished, never the removed old name', () => {
      load();
      fixture.componentInstance.toggleFinished();
      const req = listRequest();

      expect(req.request.params.get('includeFinished')).toBe('true');
      expect(req.request.params.has('includeCancelled')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('reads the match count from X-Total-Count', () => {
      load([row('a'), row('b')], 57);

      expect(fixture.componentInstance.total()).toBe(57);
      expect(text()).toContain('1–2 sur 57');
    });
  });

  describe('FR-33 — the schedule', () => {
    it('groups rows by day and renders the time of each', () => {
      load(
        [
          row('a', { scheduledAt: '2026-09-10T09:00:00.000Z' }),
          row('b', { scheduledAt: '2026-09-10T14:30:00.000Z' }),
          row('c', { scheduledAt: '2026-09-11T11:00:00.000Z' }),
        ],
        3,
      );

      expect(fixture.componentInstance.days().length).toBe(2);
      expect(fixture.nativeElement.querySelectorAll('.day').length).toBe(2);
      const times = Array.from(fixture.nativeElement.querySelectorAll('.rows__time')).map((e) =>
        (e as HTMLElement).textContent?.trim(),
      );
      expect(times).toEqual([
        localTime('2026-09-10T09:00:00.000Z'),
        localTime('2026-09-10T14:30:00.000Z'),
        localTime('2026-09-11T11:00:00.000Z'),
      ]);
    });

    it('groups by the LOCAL day, not the UTC date, so headings match the times', () => {
      // 22:30 UTC is the NEXT local day in any positive offset. Grouping on
      // `scheduledAt.slice(0,10)` would file it under the previous heading
      // while the row below showed tomorrow's time.
      const iso = '2026-09-10T22:30:00.000Z';
      load([row('a', { scheduledAt: iso })], 1);

      const at = new Date(iso);
      const expected = [
        at.getFullYear(),
        String(at.getMonth() + 1).padStart(2, '0'),
        String(at.getDate()).padStart(2, '0'),
      ].join('-');
      expect(fixture.componentInstance.days()[0].date).toBe(expected);
    });

    it('preserves the SERVER ordering rather than re-sorting client-side', () => {
      // Deliberately out of chronological order: the server decides.
      load(
        [
          row('late', { scheduledAt: '2026-09-12T09:00:00.000Z' }),
          row('early', { scheduledAt: '2026-09-10T09:00:00.000Z' }),
        ],
        2,
      );

      expect(fixture.componentInstance.days().map((d) => d.date)).toEqual([
        '2026-09-12',
        '2026-09-10',
      ]);
    });

    it('renders candidate, poste and responsable, each linked where a page exists', () => {
      load();

      expect(text()).toContain('Candidat a');
      expect(text()).toContain('Développeur backend');
      expect(text()).toContain('Pierre Blanc');
      expect(
        (fixture.nativeElement.querySelector('.rows__link') as HTMLAnchorElement).getAttribute(
          'href',
        ),
      ).toBe('/candidates/c-a');
      expect(
        (fixture.nativeElement.querySelector('.rows__sublink') as HTMLAnchorElement).getAttribute(
          'href',
        ),
      ).toBe('/job-positions/p1');
    });

    it('FR-35 / D-040: the CV link is this API proxy route, never storage', () => {
      load();

      const link = fixture.nativeElement.querySelector('a[href*="/resume"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/api/v1/candidates/c-a/resume');
      expect(fixture.nativeElement.innerHTML).not.toContain('cloudinary');
    });

    it('offers no CV link when the candidate has none', () => {
      load([row('a', { candidate: { id: 'c-a', fullName: 'X', hasResume: false, resumeUrl: '' } })], 1);

      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeNull();
    });

    it('renders the status through the shared badge', () => {
      load([row('a', { status: 'Annulé' })], 1);

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip');
      // textContent, not innerText — the chip is uppercased by CSS.
      expect(chip.textContent.trim()).toBe('Annulé');
    });

    it('survives a row whose candidate or poste did not resolve', () => {
      load([row('a', { candidate: null, jobPosition: null, interviewer: null })], 1);

      expect(text()).toContain('Candidat inconnu');
      expect(text()).toContain('Poste inconnu');
      expect(text()).toContain('Responsable inconnu');
    });
  });

  describe('FR-33 — filters', () => {
    it('derives its options from the rows on screen, not from a user endpoint', () => {
      // A Responsable can read neither /users nor /job-positions, so the
      // options must come from data they already have.
      load(
        [
          row('a', { interviewer: { id: 'u2', name: 'Pierre' } }),
          row('b', { interviewer: { id: 'u3', name: 'Sofia' } }),
          row('c', { interviewer: { id: 'u2', name: 'Pierre' } }),
        ],
        3,
      );

      expect(fixture.componentInstance.interviewerOptions().map((o) => o.name)).toEqual([
        'Pierre',
        'Sofia',
      ]);
      expect(fixture.componentInstance.positionOptions().length).toBe(1);
    });

    it('sends the date range, responsable and poste filters', () => {
      load();

      fixture.componentInstance.setFilter('fromDate', '2026-09-01');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.componentInstance.setFilter('interviewerId', 'u2');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.componentInstance.setFilter('jobPositionId', 'p1');
      const req = listRequest();

      expect(req.request.params.get('fromDate')).toBe('2026-09-01');
      expect(req.request.params.get('interviewerId')).toBe('u2');
      expect(req.request.params.get('jobPositionId')).toBe('p1');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('a cleared filter DROPS the param — an empty value would be a 400', () => {
      load();
      fixture.componentInstance.setFilter('interviewerId', 'u2');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });

      fixture.componentInstance.setFilter('interviewerId', '');
      const req = listRequest();

      expect(req.request.params.has('interviewerId')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('distinguishes "nothing planned" from "nothing matches"', () => {
      load([], 0);
      expect(text()).toContain('Aucun entretien planifié.');

      fixture.componentInstance.setFilter('interviewerId', 'u2');
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('Aucun entretien ne correspond à ces filtres.');
    });
  });

  describe('FR-34 — cancellation', () => {
    it('offers cancel to a Recruteur on a PLANNED interview only', () => {
      signIn('Recruteur');
      load([row('a', { status: 'Planifié' }), row('b', { status: 'Annulé' })], 2);

      expect(fixture.componentInstance.canCancel(row('a', { status: 'Planifié' }))).toBeTrue();
      expect(fixture.componentInstance.canCancel(row('b', { status: 'Annulé' }))).toBeFalse();
    });

    it('does NOT offer cancel to a Responsable — FR-34 is the recruiter’s action', () => {
      signIn('ResponsableHierarchique');
      load();

      expect(fixture.componentInstance.canCancel(row('a'))).toBeFalse();
    });

    it('refuses a blank motive without calling the server', () => {
      signIn('Recruteur');
      load();

      fixture.componentInstance.startCancel(row('a'));
      fixture.componentInstance.cancelReason.set('   ');
      fixture.componentInstance.confirmCancel();

      expect(fixture.componentInstance.cancelError()).toContain('motif');
      // http.verify() in afterEach proves no request was made.
    });

    it('posts the trimmed motive and RELOADS rather than patching the row', () => {
      signIn('Recruteur');
      load();

      fixture.componentInstance.startCancel(row('a'));
      fixture.componentInstance.cancelReason.set('  Candidat indisponible.  ');
      fixture.componentInstance.confirmCancel();

      const req = http.expectOne(`${environment.apiUrl}/interviews/a/cancel`);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({ cancellationReason: 'Candidat indisponible.' });
      req.flush({});

      // Cancelling also reverts the candidate's stage and removes the row from
      // the default view — guessing the new shape would be a lie.
      listRequest().flush([], { headers: { 'X-Total-Count': '0' } });
      expect(fixture.componentInstance.cancelling()).toBeNull();
    });

    it("NFR-09: surfaces the server's own refusal, keeping the dialog open", () => {
      signIn('Recruteur');
      load();

      fixture.componentInstance.startCancel(row('a'));
      fixture.componentInstance.cancelReason.set('Motif');
      fixture.componentInstance.confirmCancel();

      http.expectOne(`${environment.apiUrl}/interviews/a/cancel`).flush(
        {
          error: {
            code: 'INVALID_STAGE_TRANSITION',
            message: 'Ce candidat a déjà dépassé l’étape « Entretien planifié ».',
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.cancelError()).toContain('déjà dépassé');
      expect(fixture.componentInstance.cancelling()).not.toBeNull();
    });
  });

  describe('Errors', () => {
    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      listRequest().flush(null, { status: 401, statusText: 'Unauthorized' });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it("NFR-09: shows the server's message on a 400, with a retry", () => {
      create();
      listRequest().flush(
        { error: { code: 'VALIDATION_ERROR', message: '« fromDate » doit précéder « toDate ».' } },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('« fromDate » doit précéder « toDate ».');
      expect(text()).toContain('Réessayer');
    });
  });
});

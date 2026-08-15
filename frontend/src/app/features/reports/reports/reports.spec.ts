import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Reports } from './reports';
import { PipelineRow, TimeToHire } from '../report.service';
import { AuthService, AuthenticatedUser } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../../testing/shell-requests';

/**
 * SRS Section 1.5 — user stories 22 and 23.
 *
 * The assertions that matter are about the two fields the API carries
 * specifically to stop a reader drawing a wrong conclusion — `jobPosition.status`
 * and `hires` — and about null averages, which must never render as zero.
 */
describe('Reports (user stories 22, 23)', () => {
  let fixture: ComponentFixture<Reports>;
  let http: HttpTestingController;
  let router: Router;

  const PIPELINE = `${environment.apiUrl}/reports/pipeline`;
  const HIRE = `${environment.apiUrl}/reports/time-to-hire`;

  const STAGES = {
    'Candidature reçue': 3,
    'Présélection CV validée': 2,
    'Entretien planifié': 1,
    'Évaluation complétée': 0,
    Accepté: 1,
    Rejeté: 0,
    'Rejeté (CV)': 2,
  };

  const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
    jobPosition: { id: 'p1', title: 'Développeur Angular', status: 'Ouvert' },
    stages: { ...STAGES },
    total: 9,
    ...over,
  });

  const hire = (over: Partial<TimeToHire> = {}): TimeToHire => ({
    fromDate: null,
    toDate: null,
    hires: 12,
    averageDays: 21.5,
    fastestDays: 8,
    slowestDays: 44.2,
    ...over,
  });

  const signIn = (role: AuthenticatedUser['role']): void => {
    TestBed.inject(AuthService).currentUser.set({
      id: 'u1',
      name: 'Test User',
      email: 'test@example.com',
      role,
      departmentId: 'd1',
      mustChangePassword: false,
    });
  };

  const pipelineRequest = (): TestRequest => http.expectOne((r) => r.url === PIPELINE);
  const hireRequest = (): TestRequest => http.expectOne((r) => r.url === HIRE);

  /** Creates the page and answers BOTH reports, which are separate requests. */
  const load = (rows: PipelineRow[] = [row()], summary: TimeToHire = hire()): void => {
    fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    pipelineRequest().flush(rows);
    hireRequest().flush(summary);
    fixture.detectChanges();
  };

  /** `textContent`, never `innerText` — headers and chips are uppercased. */
  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    // The topbar badge (D-081) fires on every shell render. Drained narrowly,
    // so a stray request of any OTHER url still fails the spec.
    drainShellRequests(http);
    http.verify();
  });

  describe('No new endpoint — the two D-059 routes', () => {
    it('asks for both reports, unfiltered, with the session cookie', () => {
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();

      const pipeline = pipelineRequest();
      expect(pipeline.request.method).toBe('GET');
      expect(pipeline.request.withCredentials).toBeTrue();
      // No jobPositionId key at all on an unfiltered load — an empty value is
      // an invalid id, not the absence of one.
      expect(pipeline.request.params.keys()).toEqual([]);

      const summary = hireRequest();
      expect(summary.request.withCredentials).toBeTrue();
      expect(summary.request.params.keys()).toEqual([]);

      pipeline.flush([row()]);
      summary.flush(hire());
    });

    it('sends NO scope of its own — the server decides what a role may see', () => {
      signIn('ResponsableHierarchique');
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();

      // NFR-04: asking for a department from the client is exactly what a
      // server-side scope exists to avoid.
      // Captured ONCE: expectOne consumes the request, so calling it twice
      // asserts against a request that is no longer pending.
      const pipeline = pipelineRequest();
      expect(pipeline.request.params.has('departmentId')).toBeFalse();
      pipeline.flush([]);
      hireRequest().flush(hire({ hires: 0, averageDays: null, fastestDays: null, slowestDays: null }));
    });
  });

  describe('User story 22 — pipeline par poste', () => {
    it('renders every stage column from the PAYLOAD, not a hard-coded list', () => {
      load();

      for (const stage of Object.keys(STAGES)) {
        expect(text()).withContext(stage).toContain(stage);
      }
    });

    it('shows zero counts rather than blanks — a zero is data', () => {
      load([row({ stages: { ...STAGES, Accepté: 0 }, total: 8 })]);

      const zeros = fixture.nativeElement.querySelectorAll('.table__num--zero');
      // Évaluation complétée, Accepté, Rejeté.
      expect(zeros.length).toBe(3);
    });

    it('D-059: carries the position STATUS, so a zero can be interpreted', () => {
      load([row({ jobPosition: { id: 'p1', title: 'Poste fermé', status: 'Clôturé' }, total: 0,
        stages: Object.fromEntries(Object.keys(STAGES).map((s) => [s, 0])) })]);

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip') as HTMLElement;
      // Zero candidates on a CLOSED posting means something different from
      // zero on an open one, and the number alone cannot say which.
      expect(chip.textContent!.trim()).toBe('Clôturé');
    });

    it('includes positions with NO candidates at all', () => {
      load([
        row(),
        row({
          jobPosition: { id: 'p2', title: 'Poste vide', status: 'Ouvert' },
          stages: Object.fromEntries(Object.keys(STAGES).map((s) => [s, 0])),
          total: 0,
        }),
      ]);

      expect(text()).toContain('Poste vide');
      expect(fixture.componentInstance.rows().length).toBe(2);
    });

    it('totals across positions, so the page states its own denominator', () => {
      load([row({ total: 9 }), row({ jobPosition: { id: 'p2', title: 'B', status: 'Ouvert' }, total: 4 })]);

      expect(fixture.componentInstance.grandTotal()).toBe(13);
      expect(text()).toContain('13 candidats');
      expect(text()).toContain('2 postes');
    });

    it('derives the poste filter from the ROWS, not from a positions endpoint', () => {
      load([row(), row({ jobPosition: { id: 'p2', title: 'Chef de projet', status: 'Ouvert' } })]);

      const values = Array.from(
        (fixture.nativeElement.querySelector('#report-position') as HTMLSelectElement).options,
      ).map((o) => o.value);
      expect(values).toEqual(['', 'p1', 'p2']);
      // GET /job-positions is closed to the Responsable (D-038), who IS allowed
      // on this page — so there is no positions endpoint to build a picker from.
      expectNoPageRequests(http);
    });

    it('sends jobPositionId when one is chosen, and shows the shared breakdown', () => {
      load();

      fixture.componentInstance.selectPosition('p1');
      const req = http.expectOne((r) => r.url === PIPELINE);
      expect(req.request.params.get('jobPositionId')).toBe('p1');
      req.flush([row()]);
      fixture.detectChanges();

      // Reused, not reinvented: PipelineBreakdown already renders seven CSS
      // bars for the FR-45/FR-46 dashboards.
      expect(fixture.nativeElement.querySelector('app-pipeline-breakdown')).toBeTruthy();
    });

    it('the breakdown is NOT shown for the unfiltered multi-position view', () => {
      load([row(), row({ jobPosition: { id: 'p2', title: 'B', status: 'Ouvert' } })]);

      expect(fixture.nativeElement.querySelector('app-pipeline-breakdown')).toBeNull();
    });

    it('a focused position with no candidates says so, and draws no empty bars', () => {
      load();
      fixture.componentInstance.selectPosition('p1');
      http.expectOne((r) => r.url === PIPELINE).flush([
        row({ stages: Object.fromEntries(Object.keys(STAGES).map((s) => [s, 0])), total: 0 }),
      ]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-pipeline-breakdown')).toBeNull();
      expect(text()).toContain("C'est un résultat, pas une absence de donnée");
    });
  });

  describe('User story 23 — délai de recrutement', () => {
    it('renders the figures WITH the sample size', () => {
      load();

      expect(text()).toContain('21.5 j');
      expect(text()).toContain('8 j');
      expect(text()).toContain('44.2 j');
      // The server returns `hires` so the average can be judged; dropping it
      // would hide what the number rests on.
      expect(text()).toContain('12');
      expect(text()).toContain("Taille de l'échantillon");
    });

    it('NO hires renders no tiles at all — never four zeroes', () => {
      load([row()], hire({ hires: 0, averageDays: null, fastestDays: null, slowestDays: null }));

      // Zero days would be a false claim of instant hiring, which is exactly
      // why the server sends null rather than 0.
      expect(fixture.nativeElement.querySelectorAll('app-stat-tile').length).toBe(0);
      expect(text()).toContain('Aucun recrutement conclu');
      expect(text()).not.toContain('0 j');
    });

    it('warns when the average rests on a handful of hires', () => {
      load([row()], hire({ hires: 3, averageDays: 19 }));

      expect(text()).toContain('3 recrutements seulement');
      expect(text()).toContain('ordre de grandeur');
    });

    it('does NOT warn on a healthy sample', () => {
      load();

      expect(text()).not.toContain('ordre de grandeur');
    });

    it('sends only the dates that are set', () => {
      load();

      fixture.componentInstance.setFrom('2026-01-01');
      const first = http.expectOne((r) => r.url === HIRE);
      expect(first.request.params.get('fromDate')).toBe('2026-01-01');
      // An empty `toDate=` is an invalid date, not the absence of one.
      expect(first.request.params.has('toDate')).toBeFalse();
      first.flush(hire());

      fixture.componentInstance.setTo('2026-03-31');
      const both = http.expectOne((r) => r.url === HIRE);
      expect(both.request.params.get('fromDate')).toBe('2026-01-01');
      expect(both.request.params.get('toDate')).toBe('2026-03-31');
      both.flush(hire());
      fixture.detectChanges();

      // The period means DECISION dates, and the page says so.
      expect(text()).toContain('date de');
      expect(text()).toContain('pas sur la date');
    });

    it('resets both dates in ONE request, not two', () => {
      load();
      fixture.componentInstance.setFrom('2026-01-01');
      http.expectOne((r) => r.url === HIRE).flush(hire());

      fixture.componentInstance.resetPeriod();

      const cleared = http.expectOne((r) => r.url === HIRE);
      expect(cleared.request.params.keys()).toEqual([]);
      cleared.flush(hire());
    });

    it('changing the period does NOT re-fetch the pipeline', () => {
      load();

      fixture.componentInstance.setFrom('2026-01-01');
      http.expectOne((r) => r.url === HIRE).flush(hire());

      // Two independent reports; refetching the other would be pure waste.
      expectNoPageRequests(http);
    });
  });

  describe('Roles — what the PAGE says, not what it enforces', () => {
    it('tells a Responsable their reports are department-scoped', () => {
      signIn('ResponsableHierarchique');
      load();

      // D-047 narrows them server-side; three postings must not read as the
      // company having three.
      expect(text()).toContain('ne couvrent que votre département');
    });

    it('says no such thing to a Recruteur or an Administrateur', () => {
      for (const role of ['Recruteur', 'Administrateur'] as const) {
        signIn(role);
        load();
        expect(text()).withContext(role).not.toContain('ne couvrent que votre département');
        drainShellRequests(http);
      }
    });

    it('D-068: an Administrateur sees the same reports, and no write action', () => {
      signIn('Administrateur');
      load();

      expect(text()).toContain('Développeur Angular');
      // Both routes are GETs; the module exposes no write to offer.
      expect(text()).not.toMatch(/Supprimer|Modifier|Enregistrer/);
    });
  });

  describe('The two reports fail INDEPENDENTLY', () => {
    it('a broken time-to-hire does not blank a pipeline that loaded', () => {
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      pipelineRequest().flush([row()]);
      hireRequest().flush(
        { error: { code: 'VALIDATION_ERROR', message: 'La date de fin précède la date de début.' } },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Développeur Angular');
      expect(text()).toContain('La date de fin précède la date de début.');
      // NFR-09: an inverted range is a fixable mistake, not an outage.
      expect(text()).not.toContain('momentanément indisponible');
    });

    it('a broken pipeline does not blank the figures that loaded', () => {
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      pipelineRequest().flush(null, { status: 500, statusText: 'Server Error' });
      hireRequest().flush(hire());
      fixture.detectChanges();

      expect(text()).toContain('21.5 j');
      expect(text()).toContain('Le rapport de pipeline est momentanément indisponible.');
    });

    it('a 403 is shown as the server wrote it', () => {
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      pipelineRequest().flush(
        { error: { code: 'FORBIDDEN', message: "Votre compte n'est rattaché à aucun département." } },
        { status: 403, statusText: 'Forbidden' },
      );
      hireRequest().flush(hire());
      fixture.detectChanges();

      expect(text()).toContain("n'est rattaché à aucun département");
    });

    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      pipelineRequest().flush(null, { status: 401, statusText: 'Unauthorized' });
      hireRequest().flush(hire());

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('reports an unreachable server', () => {
      fixture = TestBed.createComponent(Reports);
      fixture.detectChanges();
      pipelineRequest().error(new ProgressEvent('error'), { status: 0, statusText: '' });
      hireRequest().flush(hire());
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });
  });
});

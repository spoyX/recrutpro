import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuditLog, AuditEntry } from './audit-log';
import { environment } from '../../../../environments/environment';
import { drainShellRequests } from '../../../testing/shell-requests';

/**
 * UC-04 / FR-11.
 *
 * The assertion that matters most is the CAP: the endpoint returns at most 50
 * rows and accepts no offset, so a page that renders 50 rows without saying the
 * total would let a capped view look like the whole history.
 */
describe('AuditLog (FR-11, UC-04)', () => {
  let fixture: ComponentFixture<AuditLog>;
  let http: HttpTestingController;
  let router: Router;

  const URL = `${environment.apiUrl}/audit-logs`;

  const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
    id: 'a1',
    action: 'UtilisateurDesactive',
    targetType: 'User',
    targetId: '64b7f0c2e1a2b3c4d5e6f7a8',
    timestamp: '2026-08-16T09:30:15.000Z',
    user: { id: 'u1', name: 'Admin Un' },
    ...over,
  });

  const request = (): TestRequest => http.expectOne((r) => r.url === URL);

  const load = (
    rows: AuditEntry[] = [entry()],
    total = rows.length,
    limit = 50,
  ): void => {
    fixture = TestBed.createComponent(AuditLog);
    fixture.detectChanges();
    request().flush(rows, {
      headers: { 'X-Total-Count': String(total), 'X-Page-Limit': String(limit) },
    });
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditLog],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    drainShellRequests(http);
    http.verify();
  });

  describe('The request', () => {
    it('asks unfiltered, with the session cookie', () => {
      fixture = TestBed.createComponent(AuditLog);
      fixture.detectChanges();

      const req = request();
      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBeTrue();
      // An empty `action=` is an unknown enum value the server 400s.
      expect(req.request.params.keys()).toEqual([]);

      req.flush([], { headers: { 'X-Total-Count': '0', 'X-Page-Limit': '50' } });
    });

    it('sends each filter, and clears them together', () => {
      load();

      fixture.componentInstance.setAction('PosteCloture');
      const byAction = request();
      expect(byAction.request.params.get('action')).toBe('PosteCloture');
      expect(byAction.request.params.has('targetType')).toBeFalse();
      byAction.flush([], { headers: { 'X-Total-Count': '0', 'X-Page-Limit': '50' } });

      fixture.componentInstance.setTargetType('JobPosition');
      const both = request();
      expect(both.request.params.get('action')).toBe('PosteCloture');
      expect(both.request.params.get('targetType')).toBe('JobPosition');
      both.flush([], { headers: { 'X-Total-Count': '0', 'X-Page-Limit': '50' } });
      fixture.detectChanges();

      fixture.componentInstance.resetFilters();
      const cleared = request();
      expect(cleared.request.params.keys()).toEqual([]);
      cleared.flush([entry()], { headers: { 'X-Total-Count': '1', 'X-Page-Limit': '50' } });
    });

    it('offers only the enum values the endpoint accepts', () => {
      load();

      const actions = Array.from(
        (fixture.nativeElement.querySelector('#filter-action') as HTMLSelectElement).options,
      ).map((o) => o.value);
      // Exact set, not a spot check: an option the server does not know is a
      // 400 waiting for whoever picks it.
      expect(actions.length).toBe(17); // 16 actions + « toutes »
      expect(actions[0]).toBe('');
      expect(actions).toContain('MotDePasseReinitialise');
      expect(actions).toContain('EvaluationSoumise');

      const targets = Array.from(
        (fixture.nativeElement.querySelector('#filter-target') as HTMLSelectElement).options,
      ).map((o) => o.value);
      expect(targets).toEqual([
        '',
        'User',
        'Department',
        'JobPosition',
        'Candidate',
        'Interview',
        'InterviewEvaluation',
      ]);
    });
  });

  describe('The rows', () => {
    it('renders who, what, when and the target', () => {
      load();

      expect(text()).toContain('Admin Un');
      expect(text()).toContain('UtilisateurDesactive');
      expect(text()).toContain('User');
      expect(text()).toContain('64b7f0c2e1a2b3c4d5e6f7a8');
      expect(text()).toContain('16/08/2026');
    });

    it('survives an entry whose actor is gone', () => {
      load([entry({ user: null })]);

      // One orphaned entry must not break the page — « qui » is the point, so
      // its absence is named rather than left blank.
      expect(text()).toContain('Auteur inconnu');
    });

    it('D-033: states that an entry carries no payload', () => {
      load();

      // A reader expecting a diff would otherwise conclude the page is broken
      // rather than that the record is deliberately minimal.
      expect(text()).toContain('jamais le détail de ce qui a changé');
    });
  });

  describe('The CAP — the endpoint pages nothing', () => {
    it('says « les N plus récentes sur M » when the total exceeds what came back', () => {
      load([entry(), entry({ id: 'a2' })], impliedTotal(), 50);

      expect(text()).toContain('Les 2 plus récentes sur 137');
      expect(text()).toContain('Seules les 50 entrées les plus récentes');
    });

    it('says the plain total when nothing is hidden', () => {
      load([entry(), entry({ id: 'a2' })], 2, 50);

      expect(text()).toContain('2 entrées');
      expect(text()).not.toContain('plus récentes sur');
      expect(text()).not.toContain('Seules les');
    });

    it('renders NO pager — the endpoint accepts no offset', () => {
      load([entry()], 137, 50);

      // A pager that cannot page is worse than none.
      expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
      expect(text()).not.toContain('Suivant');
    });

    it("reads the cap from X-Page-Limit rather than assuming 50", () => {
      load([entry()], 90, 25);

      expect(fixture.componentInstance.limit()).toBe(25);
      expect(text()).toContain('Seules les 25 entrées les plus récentes');
    });
  });

  describe('Empty and error states', () => {
    it('distinguishes "empty" from "nothing matches"', () => {
      load([], 0);
      expect(text()).toContain("Le journal d'audit est vide");

      fixture.componentInstance.setAction('PosteCree');
      request().flush([], { headers: { 'X-Total-Count': '0', 'X-Page-Limit': '50' } });
      fixture.detectChanges();

      expect(text()).toContain('Aucune entrée ne correspond');
    });

    it("a 403 shows the server's own message", () => {
      fixture = TestBed.createComponent(AuditLog);
      fixture.detectChanges();
      request().flush(
        {
          error: {
            code: 'FORBIDDEN',
            message: "Votre rôle ne vous autorise pas à accéder à cette ressource.",
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Votre rôle ne vous autorise pas');
      expect(text()).not.toContain('momentanément indisponible');
    });

    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      fixture = TestBed.createComponent(AuditLog);
      fixture.detectChanges();
      request().flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('reports an unreachable server', () => {
      fixture = TestBed.createComponent(AuditLog);
      fixture.detectChanges();
      request().error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });
  });
});

/** The total the cap test pretends the collection holds. */
function impliedTotal(): number {
  return 137;
}

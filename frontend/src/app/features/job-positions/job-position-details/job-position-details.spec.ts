import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { JobPositionDetails } from './job-position-details';
import { JobPosition } from '../job-position.service';
import { CandidateListItem } from '../../candidates/candidate.service';
import { AuthService, AuthenticatedUser } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

describe('JobPositionDetails (FR-14 to FR-17)', () => {
  let fixture: ComponentFixture<JobPositionDetails>;
  let http: HttpTestingController;
  let router: Router;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const DEPT = 'd1';
  const URL = `${environment.apiUrl}/job-positions/${ID}`;
  const DEPARTMENTS_URL = `${environment.apiUrl}/departments`;
  const CANDIDATES_URL = `${environment.apiUrl}/candidates`;

  const position: JobPosition = {
    id: ID,
    title: 'Développeur backend',
    departmentId: DEPT,
    description: 'Node et TypeScript.',
    requirements: '3 ans d’expérience.',
    status: 'Ouvert',
    createdAt: '2026-07-20T08:00:00.000Z',
  };

  const candidate = (id: string, overrides: Partial<CandidateListItem> = {}): CandidateListItem => ({
    id,
    fullName: `Candidat ${id}`,
    email: `${id}@example.com`,
    phone: '0612345678',
    jobPosition: { id: ID, title: position.title },
    currentStage: 'Candidature reçue',
    registeredAt: '2026-08-01T09:00:00.000Z',
    hasResume: true,
    ...overrides,
  });

  const create = (): void => {
    fixture = TestBed.createComponent(JobPositionDetails);
    fixture.componentRef.setInput('id', ID);
    fixture.detectChanges();
  };

  const only = (url: string): TestRequest => {
    const matches = http.match((r) => r.url === url);
    expect(matches.length).toBe(1);
    return matches[0];
  };

  const load = (
    overrides: Partial<JobPosition> = {},
    rows: CandidateListItem[] = [candidate('a')],
    total = 1,
  ): void => {
    create();
    only(URL).flush({ ...position, ...overrides });
    fixture.detectChanges();
    only(DEPARTMENTS_URL).flush([{ id: DEPT, name: 'Ingénierie' }]);
    only(CANDIDATES_URL).flush(rows, { headers: { 'X-Total-Count': String(total) } });
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobPositionDetails],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('D-001 — requests', () => {
    it('asks for the position with credentials', () => {
      create();
      const req = only(URL);

      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBeTrue();
      req.flush(position);
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush([]);
      only(CANDIDATES_URL).flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('scopes the candidate query to THIS position', () => {
      create();
      only(URL).flush(position);
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush([]);

      const req = only(CANDIDATES_URL);
      expect(req.request.params.get('jobPositionId')).toBe(ID);
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('D-035: asks for INACTIVE departments too, or a retired one renders unknown', () => {
      create();
      only(URL).flush(position);
      fixture.detectChanges();

      const req = only(DEPARTMENTS_URL);
      expect(req.request.params.get('includeInactive')).toBe('true');
      req.flush([]);
      only(CANDIDATES_URL).flush([], { headers: { 'X-Total-Count': '0' } });
    });
  });

  describe('FR-14 — the position', () => {
    it('renders title, description, requirements and the creation date', () => {
      load();

      expect(text()).toContain('Développeur backend');
      expect(text()).toContain('Node et TypeScript.');
      expect(text()).toContain('3 ans d’expérience.');
      expect(text()).toContain('20/07/2026');
    });

    it('resolves the department id to its NAME', () => {
      load();

      expect(text()).toContain('Ingénierie');
      expect(text()).not.toContain(DEPT);
    });

    it('renders the status through the shared badge', () => {
      load();

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip');
      // textContent, not innerText — the chip is uppercased by CSS.
      expect(chip.textContent.trim()).toBe('Ouvert');
      expect(chip.classList).toContain('chip--info');
    });

    it('omits the requirements block when there are none', () => {
      load({ requirements: null });

      expect(text()).not.toContain('Exigences');
    });

    it('FR-16: says so when the position is closed', () => {
      load({ status: 'Clôturé' });

      expect(text()).toContain('aucun nouveau candidat');
    });

    it('D-052: never renders an owner — createdBy is not in the payload at all', () => {
      load();

      expect(text()).not.toContain('createdBy');
      expect(text()).not.toMatch(/propriétaire|créé par/i);
    });
  });

  describe('FR-24 — the candidates on this position', () => {
    it('lists them with their stage, linking to each file', () => {
      load({}, [candidate('c1', { fullName: 'Jean Martin', currentStage: 'Accepté' })], 1);

      expect(text()).toContain('Jean Martin');
      const link = fixture.nativeElement.querySelector('.rows__link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/candidates/c1');
      const chips = fixture.nativeElement.querySelectorAll('app-stage-chip .chip');
      // First chip is the position status; the second is the candidate stage.
      expect(chips[1].textContent.trim()).toBe('Accepté');
    });

    it('shows the total from X-Total-Count, not the rendered row count', () => {
      load({}, [candidate('a'), candidate('b')], 42);

      expect(fixture.componentInstance.candidateTotal()).toBe(42);
      expect(text()).toContain('42');
    });

    it('offers a link to the full list ONLY when it is not showing everything', () => {
      load({}, [candidate('a'), candidate('b')], 42);
      expect(text()).toContain('Voir les 42 candidats');

      load({}, [candidate('a')], 1);
      expect(text()).not.toContain('Voir les');
    });

    it('shows an empty state when nobody has applied', () => {
      load({}, [], 0);

      expect(text()).toContain("Aucun candidat n'est rattaché à ce poste.");
    });

    it('D-068: a 403 on the candidate list states the rule and keeps the position', () => {
      create();
      only(URL).flush(position);
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush([{ id: DEPT, name: 'Ingénierie' }]);
      only(CANDIDATES_URL).flush(
        { error: { code: 'FORBIDDEN', message: 'Rôle non autorisé.' } },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();

      // The Administrateur may read the position but not the candidate list.
      expect(text()).toContain("n'est pas accessible à votre rôle");
      expect(text()).toContain('Développeur backend');
      expect(fixture.componentInstance.errorMessage()).toBeNull();
    });
  });

  // FR-15/FR-16 reached from the file rather than only from the FR-17 list.
  // Both are affordances: D-038 and D-037 are enforced server-side (NFR-04).
  describe('FR-15 / FR-16 — the write actions (D-079)', () => {
    const signIn = (role: AuthenticatedUser['role']): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        role,
        departmentId: DEPT,
        mustChangePassword: false,
      });
    };

    const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
      Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
        (b as HTMLElement).textContent?.includes(label),
      ) as HTMLButtonElement | undefined;

    it('a Recruteur on an OPEN position is offered both', () => {
      signIn('Recruteur');
      load();

      expect(buttonLabelled('Modifier')).toBeTruthy();
      expect(buttonLabelled('Clôturer')).toBeTruthy();
    });

    it('D-037: a CLOSED position is offered neither', () => {
      signIn('Recruteur');
      load({ status: 'Clôturé' });

      // The server 409s an edit and a re-close alike; a button here could only
      // walk the reader into one.
      expect(buttonLabelled('Modifier')).toBeUndefined();
      expect(buttonLabelled('Clôturer')).toBeUndefined();
      // …and the existing closed-state note still explains why.
      expect(text()).toContain('aucun nouveau candidat');
    });

    it('D-068: an Administrateur reads the position and is offered neither', () => {
      signIn('Administrateur');
      load();

      expect(text()).toContain('Développeur backend');
      expect(buttonLabelled('Modifier')).toBeUndefined();
      expect(buttonLabelled('Clôturer')).toBeUndefined();
    });

    it('FR-18/D-038: no delete action, for any role', () => {
      signIn('Recruteur');
      load();

      expect(buttonLabelled('Supprimer')).toBeUndefined();
      expect(text()).not.toContain('Supprimer');
    });

    it('a write re-reads the file — an edit can move it to another department', () => {
      signIn('Recruteur');
      load();

      fixture.componentInstance.onWritten();

      only(URL).flush({ ...position, title: 'Renommé' });
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush([{ id: DEPT, name: 'Ingénierie' }]);
      only(CANDIDATES_URL).flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('Renommé');
    });
  });

  describe('Degradation', () => {
    it('a failed department lookup does NOT break the page', () => {
      create();
      only(URL).flush(position);
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush(null, { status: 500, statusText: 'Server Error' });
      only(CANDIDATES_URL).flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('Développeur backend');
      expect(text()).toContain('Département inconnu');
    });

    it('an unknown department id renders as unknown rather than blank', () => {
      create();
      only(URL).flush(position);
      fixture.detectChanges();
      only(DEPARTMENTS_URL).flush([{ id: 'other', name: 'Ventes' }]);
      only(CANDIDATES_URL).flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('Département inconnu');
      expect(text()).not.toContain('Ventes');
    });
  });

  describe('Errors', () => {
    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      only(URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('NFR-09: a 404 shows the server message with a retry', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      only(URL).flush(
        { error: { code: 'NOT_FOUND', message: "Ce poste n'existe pas." } },
        { status: 404, statusText: 'Not Found' },
      );
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(text()).toContain("Ce poste n'existe pas.");
      expect(text()).toContain('Réessayer');
    });

    it('reports an unreachable server', () => {
      create();
      only(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });
  });
});

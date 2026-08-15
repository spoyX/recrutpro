import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { JobPositionsList } from './job-positions-list';
import { JobPosition } from '../job-position.service';
import { AuthService, AuthenticatedUser } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../../testing/shell-requests';

/**
 * FR-17 — the list, and the home of FR-14/FR-15/FR-16.
 *
 * The role assertions here are about what is OFFERED, never about what is
 * allowed: D-038 and D-068 are enforced server-side (NFR-04), and the 403 case
 * below is the half that actually matters.
 */
describe('JobPositionsList (FR-14 to FR-17)', () => {
  let fixture: ComponentFixture<JobPositionsList>;
  let http: HttpTestingController;
  let router: Router;

  const POSITIONS = `${environment.apiUrl}/job-positions`;
  const DEPARTMENTS = `${environment.apiUrl}/departments`;

  const POSITION = (over: Partial<JobPosition> = {}): JobPosition => ({
    id: 'p1',
    title: 'Développeur Angular',
    departmentId: 'd1',
    description: 'Développement.',
    requirements: null,
    status: 'Ouvert',
    createdAt: '2026-08-01T09:00:00.000Z',
    ...over,
  });

  const DEPTS = [
    { id: 'd1', name: 'Informatique', isActive: true },
    { id: 'd2', name: 'Ressources humaines', isActive: true },
  ];

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

  /** Creates the page and answers both requests it makes on construction. */
  const open = (positions: JobPosition[] = [POSITION()]): void => {
    fixture = TestBed.createComponent(JobPositionsList);
    fixture.detectChanges();

    http.expectOne((r) => r.url === POSITIONS).flush(positions);
    http.expectOne((r) => r.url === DEPARTMENTS).flush(DEPTS);
    fixture.detectChanges();
  };

  /** `textContent`, never `innerText` — headers and chips are uppercased. */
  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobPositionsList],
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

  describe('FR-17 — the list', () => {
    it('asks for every position, unfiltered, with the session cookie', () => {
      fixture = TestBed.createComponent(JobPositionsList);
      fixture.detectChanges();

      const req = http.expectOne((r) => r.url === POSITIONS);
      expect(req.request.method).toBe('GET');
      expect(req.request.withCredentials).toBeTrue();
      // No status or departmentId key at all on an unfiltered load — an empty
      // `status=` would be a filter value, not the absence of one.
      expect(req.request.params.keys()).toEqual([]);

      req.flush([]);
      http.expectOne((r) => r.url === DEPARTMENTS).flush(DEPTS);
    });

    it('renders the row, resolving the department NAME from FR-13', () => {
      signIn('Recruteur');
      open();

      expect(text()).toContain('Développeur Angular');
      // The positions payload carries `departmentId` only (D-071).
      expect(text()).toContain('Informatique');
      expect(text()).not.toContain('d1');
    });

    it('names a department the FR-13 list does not carry, rather than showing an id', () => {
      signIn('Recruteur');
      open([POSITION({ departmentId: 'gone' })]);

      expect(text()).toContain('Département inconnu');
      expect(text()).not.toContain('gone');
    });

    it('renders the status through the SHARED badge, not a private one', () => {
      signIn('Recruteur');
      open([POSITION({ status: 'Clôturé' })]);

      const chip = fixture.nativeElement.querySelector('app-stage-chip .chip') as HTMLElement;
      expect(chip.textContent).toBe('Clôturé');
      // D-066 reserves the success token for a settled positive OUTCOME; a
      // posting's status is never one.
      expect(chip.className).toContain('chip--attention');
      expect(chip.className).not.toContain('chip--positive');
    });

    it('sends each filter, and resets them together', () => {
      signIn('Recruteur');
      open();

      fixture.componentInstance.setFilter('status', 'Ouvert');
      expect(http.expectOne((r) => r.params.get('status') === 'Ouvert')).toBeTruthy();

      fixture.componentInstance.setFilter('departmentId', 'd2');
      const both = http.expectOne((r) => r.url === POSITIONS);
      expect(both.request.params.get('status')).toBe('Ouvert');
      expect(both.request.params.get('departmentId')).toBe('d2');
      both.flush([]);
      fixture.detectChanges();

      fixture.componentInstance.resetFilters();
      const cleared = http.expectOne((r) => r.url === POSITIONS);
      expect(cleared.request.params.keys()).toEqual([]);
      cleared.flush([POSITION()]);
    });

    it('distinguishes "none exist" from "none match"', () => {
      signIn('Recruteur');
      open([]);
      expect(text()).toContain("Aucun poste n'est enregistré");

      fixture.componentInstance.setFilter('status', 'Clôturé');
      http.expectOne((r) => r.url === POSITIONS).flush([]);
      fixture.detectChanges();

      expect(text()).toContain('Aucun poste ne correspond à ces filtres');
    });

    it('renders NO pager — the endpoint is unpaginated', () => {
      signIn('Recruteur');
      open();

      // A pager over a full result set would be a control that lies.
      expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
      expect(text()).not.toContain('Suivant');
    });
  });

  describe('Roles — what is OFFERED (D-038, D-068)', () => {
    it('Recruteur is offered create, edit and close', () => {
      signIn('Recruteur');
      open();

      expect(buttonLabelled('Nouveau poste')).toBeTruthy();
      expect(buttonLabelled('Modifier')).toBeTruthy();
      expect(buttonLabelled('Clôturer')).toBeTruthy();
    });

    it('Administrateur reads the list and is offered NO write action', () => {
      signIn('Administrateur');
      open();

      // D-068: read everything, write nothing. The list itself still renders.
      expect(text()).toContain('Développeur Angular');
      expect(buttonLabelled('Nouveau poste')).toBeUndefined();
      expect(buttonLabelled('Modifier')).toBeUndefined();
      expect(buttonLabelled('Clôturer')).toBeUndefined();
    });

    it('FR-18/D-038: no delete action exists for ANY role', () => {
      signIn('Recruteur');
      open();

      expect(buttonLabelled('Supprimer')).toBeUndefined();
      expect(text()).not.toContain('Supprimer');
    });

    it("D-037: a CLOSED position offers neither edit nor close, and says why", () => {
      signIn('Recruteur');
      open([POSITION({ status: 'Clôturé' })]);

      expect(buttonLabelled('Modifier')).toBeUndefined();
      expect(buttonLabelled('Clôturer')).toBeUndefined();
      // Stated rather than left as an empty cell that reads as a fault.
      expect(text()).toContain('non modifiable');
    });

    it('D-038: a Responsable gets the SERVER\'s 403 message, not an outage story', () => {
      signIn('ResponsableHierarchique');
      fixture = TestBed.createComponent(JobPositionsList);
      fixture.detectChanges();

      http.expectOne((r) => r.url === POSITIONS).flush(
        {
          error: {
            code: 'FORBIDDEN',
            message: "Votre rôle ne vous autorise pas à accéder à cette ressource.",
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );
      http.expectOne((r) => r.url === DEPARTMENTS).flush(DEPTS);
      fixture.detectChanges();

      expect(text()).toContain('Votre rôle ne vous autorise pas');
      // « momentanément indisponible » would describe a rule as an outage.
      expect(text()).not.toContain('momentanément indisponible');
    });
  });

  describe('The dialogs', () => {
    it('opening the create form issues NO position request of its own', () => {
      signIn('Recruteur');
      open();

      buttonLabelled('Nouveau poste')!.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-job-position-form')).toBeTruthy();
      // CONTROL: the dialog DOES fetch departments on init, so the observer
      // below is proven able to see a request before it is used to claim none
      // was made to the positions route.
      http.expectOne((r) => r.url === DEPARTMENTS).flush(DEPTS);
      expect(http.match((r) => r.url === POSITIONS).length).toBe(0);
    });

    it('a save re-reads the list — an edit can move a position between departments', () => {
      signIn('Recruteur');
      open();

      fixture.componentInstance.onSaved();

      http.expectOne((r) => r.url === POSITIONS).flush([POSITION({ title: 'Renommé' })]);
      fixture.detectChanges();
      expect(text()).toContain('Renommé');
    });

    it('a close re-reads the list, so the row locks immediately', () => {
      signIn('Recruteur');
      open();

      fixture.componentInstance.onClosed();

      http.expectOne((r) => r.url === POSITIONS).flush([POSITION({ status: 'Clôturé' })]);
      fixture.detectChanges();
      expect(buttonLabelled('Clôturer')).toBeUndefined();
      expect(text()).toContain('non modifiable');
    });
  });

  it('a 401 goes to the login page — FR-2 expiry or FR-8 deactivation', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(JobPositionsList);
    fixture.detectChanges();

    http
      .expectOne((r) => r.url === POSITIONS)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne((r) => r.url === DEPARTMENTS).flush(DEPTS);

    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('losing the DEPARTMENT list costs the filter, never the page', () => {
    signIn('Recruteur');
    fixture = TestBed.createComponent(JobPositionsList);
    fixture.detectChanges();

    http.expectOne((r) => r.url === POSITIONS).flush([POSITION()]);
    http
      .expectOne((r) => r.url === DEPARTMENTS)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(text()).toContain('Développeur Angular');
    expect(text()).toContain('Département inconnu');
    expect(fixture.nativeElement.querySelector('.page__error')).toBeNull();
  });
});

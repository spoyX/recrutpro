import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AppShell } from './app-shell';
import { AuthService, AuthenticatedUser } from '../../core/auth.service';
import { environment } from '../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../testing/shell-requests';

describe('AppShell — sidebar and topbar (D-067)', () => {
  let fixture: ComponentFixture<AppShell>;
  let http: HttpTestingController;
  let router: Router;

  const create = (): void => {
    fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  /**
   * Sidebar hints, read from the disabled entry's `title`.
   *
   * D-107 moved the reason off a visible « RÉSERVÉ » badge and onto the title:
   * the chip repeated on every gated row what the greyed-out state already
   * said. These assertions are unchanged in MEANING — which destinations are
   * gated, and that "not built yet" is never conflated with "not yours" — only
   * in where they read it from.
   */
  const hints = (label: string): HTMLElement[] =>
    (
      Array.from(
        fixture.nativeElement.querySelectorAll('.sidebar__link--disabled'),
      ) as HTMLElement[]
    ).filter((el) => el.getAttribute('title') === label);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShell],
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

  describe("DESIGN.md — the 280px sidebar", () => {
    it('renders a sidebar landmark', () => {
      create();

      const sidebar = fixture.nativeElement.querySelector('nav.sidebar') as HTMLElement;
      expect(sidebar).toBeTruthy();
      expect(sidebar.getAttribute('aria-label')).toBe('Navigation principale');
      // Its WIDTH is not asserted here: the 280px lives in the global
      // _tokens.scss, which Karma does not load, so a computed style would read
      // `auto` and prove nothing. The winning value is diffed against DESIGN.md
      // in the live verification instead — the same standard as the theme work.
    });

    it('links the destinations that exist', () => {
      create();

      const dashboard = fixture.nativeElement.querySelector(
        'a[href="/dashboard"]',
      ) as HTMLAnchorElement;
      expect(dashboard).toBeTruthy();
      expect(dashboard.textContent).toContain('Tableau de bord');
    });

    it('renders unbuilt destinations as DISABLED, never as links that 404', () => {
      create();

      // Every nav entry is present so the product's shape is honest…
      expect(text()).toContain('Candidats');
      expect(text()).toContain('Rapports');
      expect(text()).toContain("Journal d'audit");

      // …but they are not anchors.
      const disabled = fixture.nativeElement.querySelectorAll('.sidebar__link--disabled');
      disabled.forEach((el: Element) => {
        expect(el.getAttribute('aria-disabled')).toBe('true');
        expect(el.tagName.toLowerCase()).not.toBe('a');
      });
      // ZERO. Every sidebar destination is now built — « Journal d'audit » was
      // the last, and « à venir » no longer appears anywhere in the app. The
      // remaining disabled entries are all « réservé », which is a different
      // fact: the page exists and is not this role's.
      expect(hints('à venir').length).toBe(0);
    });
  });

  describe('Role-gated destinations (FR-24 is Recruteur-only)', () => {
    const signIn = (role: AuthenticatedUser['role']): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        role,
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    it('Recruteur: « Candidats » is a real link', () => {
      signIn('Recruteur');
      create();

      const link = fixture.nativeElement.querySelector(
        'a[href="/candidates"]',
      ) as HTMLAnchorElement;
      expect(link).toBeTruthy();
      expect(link.textContent).toContain('Candidats');
    });

    it('ResponsableHierarchique: « Candidats » is disabled, and is « réservé » not « à venir »', () => {
      signIn('ResponsableHierarchique');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      // The two disabled reasons must not be conflated: the page EXISTS, it is
      // simply not this role's. « Candidats » (D-041) and « Postes » (D-038
      // closes that module to this role entirely) are both in that state.
      // « Candidats » (D-041), « Postes » (D-038), « Utilisateurs » and
      // « Journal d'audit » (both Administrateur-only) are all « réservé ».
      expect(hints('réservé').length).toBe(4);
      expect(hints('à venir').length).toBe(0);
    });

    it('ResponsableHierarchique: « Entretiens » IS a link — FR-35 is theirs', () => {
      signIn('ResponsableHierarchique');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/interviews"]')).toBeTruthy();
    });

    it('Recruteur: « Entretiens » IS a link — FR-33 is theirs', () => {
      signIn('Recruteur');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/interviews"]')).toBeTruthy();
    });

    it('Administrateur: « Candidats » is disabled — D-068 did not widen the FR-24 list', () => {
      signIn('Administrateur');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      // Entretiens too: neither FR-33 nor FR-35 names that role.
      expect(fixture.nativeElement.querySelector('a[href="/interviews"]')).toBeNull();
      expect(hints('réservé').length).toBe(2);
      // …and both admin destinations ARE theirs, alone among the three roles.
      expect(fixture.nativeElement.querySelector('a[href="/admin/users"]')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('a[href="/admin/audit-log"]')).toBeTruthy();
    });

    it('FR-6 to FR-13: only the Administrateur gets « Utilisateurs »', () => {
      for (const role of ['Recruteur', 'ResponsableHierarchique'] as const) {
        signIn(role);
        create();
        expect(fixture.nativeElement.querySelector('a[href="/admin/users"]'))
          .withContext(role)
          .toBeNull();
        expect(fixture.nativeElement.querySelector('a[href="/admin/audit-log"]'))
          .withContext(role)
          .toBeNull();
        // Present but disabled, so the product's shape stays honest.
        expect(text()).withContext(role).toContain('Utilisateurs');
        drainShellRequests(http);
      }
    });

    it('every role keeps the dashboard link — FR-45/46/47 give all three one', () => {
      for (const role of ['Recruteur', 'ResponsableHierarchique', 'Administrateur'] as const) {
        signIn(role);
        create();
        expect(fixture.nativeElement.querySelector('a[href="/dashboard"]')).toBeTruthy();
      }
    });

    it('an ANONYMOUS visitor gets the entry disabled rather than a link that would 403', () => {
      // Since D-070 a signed-in user's role survives a refresh, so this is now
      // only the genuinely-anonymous case.
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('a[href="/interviews"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('a[href="/job-positions"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('a[href="/admin/users"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('a[href="/admin/audit-log"]')).toBeNull();
      expect(hints('réservé').length).toBe(5);
    });

    // FR-14 to FR-17. D-038 opened the module's READS to two roles and closed
    // it to the third; D-068 kept the Administrateur's half read-only.
    it('Recruteur and Administrateur both get « Postes » as a real link (D-038)', () => {
      for (const role of ['Recruteur', 'Administrateur'] as const) {
        signIn(role);
        create();

        const link = fixture.nativeElement.querySelector(
          'a[href="/job-positions"]',
        ) as HTMLAnchorElement;
        expect(link).withContext(role).toBeTruthy();
        expect(link.textContent).toContain('Postes');
      }
    });

    it('ResponsableHierarchique: « Postes » is disabled — D-038 closes the module to them', () => {
      signIn('ResponsableHierarchique');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/job-positions"]')).toBeNull();
      // Present, so the product's shape stays honest — just not a link.
      expect(text()).toContain('Postes');
    });
  });

  // FR-43/FR-44 and user story 33. In the CHROME, so the badge is reachable
  // from every page rather than only from a route nobody is on.
  describe('The notification bell (D-081)', () => {
    const signIn = (role: AuthenticatedUser['role']): void => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        role,
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
    };

    it('is in the topbar and asks for the unread count on render', () => {
      create();

      expect(fixture.nativeElement.querySelector('app-notification-panel')).toBeTruthy();
      // The shell's ONE request. Asserted by count rather than drained blindly,
      // so the helper every other page spec relies on is itself pinned here.
      expect(drainShellRequests(http)).toBe(1);
    });

    it('D-054 gates on the RECIPIENT, not the role — every role gets the bell', () => {
      for (const role of ['Recruteur', 'ResponsableHierarchique', 'Administrateur'] as const) {
        signIn(role);
        create();

        expect(fixture.nativeElement.querySelector('app-notification-panel'))
          .withContext(role)
          .toBeTruthy();
        drainShellRequests(http);
      }
    });

    it('is NOT a sidebar destination — it belongs to the topbar', () => {
      create();

      expect(fixture.nativeElement.querySelector('a[href="/notifications"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('.topbar app-notification-panel')).toBeTruthy();
      drainShellRequests(http);
    });
  });

  describe('Topbar identity', () => {
    it('renders the signed-in name and role', () => {
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Marie Dupont',
        email: 'marie@example.com',
        role: 'Recruteur',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
      create();

      expect(text()).toContain('Marie Dupont');
      expect(text()).toContain('Recruteur');
    });

    it('renders no identity block for an anonymous visitor, without erroring', () => {
      create();

      expect(fixture.nativeElement.querySelector('.topbar__identity')).toBeNull();
      expect(text()).toContain('Se déconnecter');
    });
  });

  describe('FR-4: logout', () => {
    it('calls logout and returns to the login page', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      TestBed.inject(AuthService).currentUser.set({
        id: 'u1',
        name: 'Marie',
        email: 'marie@example.com',
        role: 'Recruteur',
        departmentId: 'd1',
        mustChangePassword: false,
        avatarUrl: null,
      });
      create();

      fixture.componentInstance.logout();

      const req = http.expectOne(`${environment.apiUrl}/auth/logout`);
      expect(req.request.withCredentials).toBeTrue();
      req.flush(null);

      expect(navigate).toHaveBeenCalledWith(['/login']);
      expect(TestBed.inject(AuthService).currentUser()).toBeNull();
    });

    it('D-026: still navigates when the logout call fails — it is idempotent server-side', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();

      fixture.componentInstance.logout();
      http.expectOne(`${environment.apiUrl}/auth/logout`).flush(null, {
        status: 500,
        statusText: 'Server Error',
      });

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });
  });
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AppShell } from './app-shell';
import { AuthService, AuthenticatedUser } from '../../core/auth.service';
import { environment } from '../../../environments/environment';

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
   * Sidebar hints by their SOURCE casing. `.label-sm` applies
   * `text-transform: uppercase`, so `innerText` would report « À VENIR » —
   * `textContent` is what returns the string as written.
   */
  const hints = (label: string): HTMLElement[] =>
    (Array.from(fixture.nativeElement.querySelectorAll('.sidebar__soon')) as HTMLElement[]).filter(
      (el) => el.textContent?.trim() === label,
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

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
      // Five destinations have no page at all yet.
      expect(hints('à venir').length).toBe(5);
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

    it('ResponsableHierarchique: « Candidats » is disabled, and says « réservé » not « à venir »', () => {
      signIn('ResponsableHierarchique');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      // The two disabled reasons must not be conflated: the page EXISTS, it is
      // simply not this role's.
      expect(hints('réservé').length).toBe(1);
      expect(hints('à venir').length).toBe(5);
    });

    it('Administrateur: « Candidats » is disabled — D-068 did not widen the FR-24 list', () => {
      signIn('Administrateur');
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      expect(hints('réservé').length).toBe(1);
    });

    it('every role keeps the dashboard link — FR-45/46/47 give all three one', () => {
      for (const role of ['Recruteur', 'ResponsableHierarchique', 'Administrateur'] as const) {
        signIn(role);
        create();
        expect(fixture.nativeElement.querySelector('a[href="/dashboard"]')).toBeTruthy();
      }
    });

    it('D-065: an UNKNOWN role disables the role-gated entry rather than offering a 403 link', () => {
      // currentUser is null after a browser refresh. Showing the link would
      // 403 for two of the three roles, which is what the disabled state
      // exists to avoid — so it stays disabled. Recorded because it is the
      // point at which D-065 stops being purely cosmetic.
      create();

      expect(fixture.nativeElement.querySelector('a[href="/candidates"]')).toBeNull();
      expect(hints('réservé').length).toBe(1);
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
      });
      create();

      expect(text()).toContain('Marie Dupont');
      expect(text()).toContain('Recruteur');
    });

    it('D-065: renders no identity block when currentUser is null, without erroring', () => {
      // This is the known post-refresh gap: the session cookie is still valid
      // and the page's data loads, but currentUser was only ever set by
      // login(). The shell must degrade quietly rather than throw.
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

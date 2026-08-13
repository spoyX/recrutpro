import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AppShell } from './app-shell';
import { AuthService } from '../../core/auth.service';
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

      // …but only the built one is an anchor.
      const links = fixture.nativeElement.querySelectorAll('a.sidebar__link');
      expect(links.length).toBe(1);

      const disabled = fixture.nativeElement.querySelectorAll('.sidebar__link--disabled');
      expect(disabled.length).toBe(6);
      disabled.forEach((el: Element) => {
        expect(el.getAttribute('aria-disabled')).toBe('true');
        expect(el.tagName.toLowerCase()).not.toBe('a');
      });
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

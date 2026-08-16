import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { passwordChangeGuard } from './password-change.guard';
import { AuthService, AuthenticatedUser } from './auth.service';

/**
 * FR-10 — the routing half.
 *
 * Backend enforcement alone is a dead end: `requireAuth` 403s every protected
 * route while the flag is set, so a flagged user without this guard sees an
 * error on every page and no way out.
 */
describe('passwordChangeGuard (FR-10)', () => {
  let auth: AuthService;
  let router: Router;

  const run = (): boolean | UrlTree =>
    TestBed.runInInjectionContext(
      () => passwordChangeGuard(null as never, null as never) as boolean | UrlTree,
    );

  const signIn = (mustChangePassword: boolean): void => {
    auth.currentUser.set({
      id: 'u1',
      name: 'Marie',
      email: 'marie@example.com',
      role: 'Recruteur',
      departmentId: 'd1',
      mustChangePassword,
      avatarUrl: null,
    } satisfies AuthenticatedUser);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  it('redirects a FLAGGED user to the change-password screen', () => {
    signIn(true);

    const result = run();

    expect(result instanceof UrlTree).toBeTrue();
    // The exact destination, not merely "some UrlTree": a redirect to the wrong
    // place is the failure this guard would otherwise cause silently.
    expect(router.serializeUrl(result as UrlTree)).toBe('/change-password');
  });

  it('lets a normal user through', () => {
    signIn(false);

    expect(run()).toBeTrue();
  });

  it('lets an UNKNOWN user through — the page’s own 401 owns that case', () => {
    auth.currentUser.set(null);

    // Guessing here would fight the 401 handling every page already has, and
    // would bounce an anonymous visitor to a screen they cannot use either.
    expect(run()).toBeTrue();
  });

  it('stops redirecting once the flag clears', () => {
    signIn(true);
    expect(run() instanceof UrlTree).toBeTrue();

    // What `changePassword()` does locally on a 204.
    auth.currentUser.set({ ...auth.currentUser()!, mustChangePassword: false });

    // Before AND after: it redirected, and now it does not.
    expect(run()).toBeTrue();
  });
});

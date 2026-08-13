import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, AuthenticatedUser } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService — session rehydration (D-070, closes D-065)', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  const ME_URL = `${environment.apiUrl}/auth/me`;

  const user: AuthenticatedUser = {
    id: 'u1',
    name: 'Marie Dupont',
    email: 'marie@example.com',
    role: 'Recruteur',
    departmentId: 'd1',
    mustChangePassword: false,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts with no user — nothing is assumed before the server answers', () => {
    expect(auth.currentUser()).toBeNull();
  });

  it('D-001: asks the server with credentials — the cookie is the only credential', () => {
    auth.restoreSession().subscribe();

    const req = http.expectOne(ME_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBeTrue();
    req.flush(user);
  });

  it('populates currentUser from the session, which is the whole point', () => {
    auth.restoreSession().subscribe();
    http.expectOne(ME_URL).flush(user);

    expect(auth.currentUser()).toEqual(user);
    // The role is what the sidebar gates on; without it a Recruteur loses
    // links to pages they are entitled to use.
    expect(auth.currentUser()?.role).toBe('Recruteur');
  });

  it('treats a 401 as "anonymous", NOT as an error — it must not fail bootstrap', () => {
    let errored = false;
    let result: AuthenticatedUser | null | undefined;

    auth.restoreSession().subscribe({
      next: (value) => (result = value),
      error: () => (errored = true),
    });
    http.expectOne(ME_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(errored).toBeFalse();
    expect(result).toBeNull();
    expect(auth.currentUser()).toBeNull();
  });

  it('does not reject when the server is unreachable either', () => {
    let errored = false;

    auth.restoreSession().subscribe({ error: () => (errored = true) });
    http.expectOne(ME_URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });

    expect(errored).toBeFalse();
    expect(auth.currentUser()).toBeNull();
  });

  it('clears a stale user when the session has since expired', () => {
    auth.restoreSession().subscribe();
    http.expectOne(ME_URL).flush(user);
    expect(auth.currentUser()).not.toBeNull();

    auth.restoreSession().subscribe();
    http.expectOne(ME_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(auth.currentUser()).toBeNull();
  });

  it('FR-4: logout still clears the user', () => {
    auth.restoreSession().subscribe();
    http.expectOne(ME_URL).flush(user);

    auth.logout().subscribe();
    http.expectOne(`${environment.apiUrl}/auth/logout`).flush(null);

    expect(auth.currentUser()).toBeNull();
  });
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { ChangePassword } from './change-password';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

/**
 * FR-10's second half.
 *
 * The assertions that matter: the forced mode offers no cancel (there is
 * nowhere to cancel to), a 401 here means a wrong CURRENT password and must not
 * be mistaken for an expired session, and the local flag is cleared so the
 * guard does not bounce the user straight back.
 */
describe('ChangePassword (FR-10)', () => {
  let fixture: ComponentFixture<ChangePassword>;
  let http: HttpTestingController;
  let router: Router;
  let auth: AuthService;

  const URL = `${environment.apiUrl}/auth/change-password`;

  const signIn = (mustChangePassword: boolean): void => {
    auth.currentUser.set({
      id: 'u1',
      name: 'Marie Dupont',
      email: 'marie@example.com',
      role: 'Recruteur',
      departmentId: 'd1',
      mustChangePassword,
      avatarUrl: null,
    });
  };

  const open = (mustChangePassword = false): void => {
    signIn(mustChangePassword);
    fixture = TestBed.createComponent(ChangePassword);
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const field = (id: string): HTMLInputElement =>
    fixture.nativeElement.querySelector(`#${id}`);

  const type = (id: string, value: string): void => {
    const el = field(id);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  const fill = (current = 'Temp0rary!Pass', next = 'S3cret!Passw0rd'): void => {
    type('current-password', current);
    type('new-password', next);
    type('confirm-password', next);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  it('issues NO request when it opens', () => {
    open();
    // The COUNT is the assertion — a bare verify() records none.
    expect(http.match(() => true).length).toBe(0);
  });

  describe('Forced mode — FR-10’s « contraint »', () => {
    it('explains why, as a step rather than an error', () => {
      open(true);

      expect(text()).toContain('réinitialisé par un administrateur');
      expect(text()).toContain('Marie Dupont');
      // role="status", not role="alert": nothing has gone wrong.
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
    });

    it('offers NO cancel — every other route 403s until this is done', () => {
      open(true);

      expect(buttonLabelled('Annuler')).toBeUndefined();
      // …but signing out IS offered, so the screen is not a trap.
      expect(buttonLabelled('Se déconnecter')).toBeTruthy();
    });

    it('calls the temporary password by its name', () => {
      open(true);
      expect(text()).toContain('Mot de passe temporaire');
    });

    it('signing out leaves and does not pretend the password changed', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      open(true);

      buttonLabelled('Se déconnecter')!.click();
      http.expectOne(`${environment.apiUrl}/auth/logout`).flush(null);

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('Voluntary mode', () => {
    it('offers a cancel, because every other page is available', () => {
      open(false);

      expect(buttonLabelled('Annuler')).toBeTruthy();
      expect(buttonLabelled('Se déconnecter')).toBeUndefined();
      expect(text()).toContain('Mot de passe actuel');
      expect(text()).not.toContain('réinitialisé par un administrateur');
    });

    it('cancelling touches nothing', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      open(false);

      buttonLabelled('Annuler')!.click();

      expect(navigate).toHaveBeenCalledWith(['/dashboard']);
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('Validation', () => {
    it('requires all three fields', () => {
      open(true);
      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();

      type('current-password', 'Temp0rary!Pass');
      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();
      type('new-password', 'S3cret!Passw0rd');
      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();
      type('confirm-password', 'S3cret!Passw0rd');
      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeFalse();
    });

    it('enforces the 8-character floor the server enforces', () => {
      open(true);
      fill('Temp0rary!Pass', 'court');

      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();
    });

    it('blocks a MISMATCH, and says so', () => {
      open(true);
      type('current-password', 'Temp0rary!Pass');
      type('new-password', 'S3cret!Passw0rd');
      type('confirm-password', 'S3cret!Passw0rc');

      // The typed value becomes the only way back in; a typo is unrecoverable
      // without another administrator.
      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();
      expect(text()).toContain('ne correspondent pas');
    });

    it('blocks REUSING the current password — that would defeat FR-10', () => {
      open(true);
      fill('Temp0rary!Pass', 'Temp0rary!Pass');

      expect(buttonLabelled('Changer le mot de passe')!.disabled).toBeTrue();
      expect(text()).toContain('différent de l');
    });

    it('a programmatic submit past the disabled button sends nothing', () => {
      open(true);
      fixture.componentInstance.submit();
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('The request', () => {
    it('POSTs both passwords with the session cookie', () => {
      open(true);
      fill();

      buttonLabelled('Changer le mot de passe')!.click();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({
        currentPassword: 'Temp0rary!Pass',
        newPassword: 'S3cret!Passw0rd',
      });

      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('CLEARS the local flag, so the guard does not bounce the navigation back', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      open(true);
      expect(auth.currentUser()!.mustChangePassword).toBeTrue();

      fill();
      buttonLabelled('Changer le mot de passe')!.click();
      http.expectOne(URL).flush(null, { status: 204, statusText: 'No Content' });

      // Before AND after: the flag was set, and is not any more.
      expect(auth.currentUser()!.mustChangePassword).toBeFalse();
      expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    });
  });

  describe('Failure', () => {
    it('a 401 means the CURRENT password was wrong — it does NOT sign the user out', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      open(true);
      fill('mauvais', 'S3cret!Passw0rd');

      buttonLabelled('Changer le mot de passe')!.click();
      http.expectOne(URL).flush(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Mot de passe actuel incorrect.' } },
        { status: 401, statusText: 'Unauthorized' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Mot de passe actuel incorrect.');
      // Every other page treats 401 as an expired session. Here the session is
      // perfectly valid and a typo must not look like a timeout.
      expect(navigate).not.toHaveBeenCalled();
      // …and the flag is untouched, so the user is still on this screen.
      expect(auth.currentUser()!.mustChangePassword).toBeTrue();
    });

    it("a 400 shows the server's own message", () => {
      open(true);
      fill();
      buttonLabelled('Changer le mot de passe')!.click();
      http.expectOne(URL).flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Le mot de passe doit contenir au moins 8 caractères.',
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('au moins 8 caractères');
    });

    it('reports an unreachable server', () => {
      open(true);
      fill();
      buttonLabelled('Changer le mot de passe')!.click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
      expect(auth.currentUser()!.mustChangePassword).toBeTrue();
    });
  });
});

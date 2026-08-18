import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Login } from './login';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

describe('Login (FR-1, FR-3)', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;
  let http: HttpTestingController;
  let router: Router;

  const LOGIN_URL = `${environment.apiUrl}/auth/login`;

  const user = {
    id: 'u1',
    name: 'Marie',
    email: 'marie@example.com',
    role: 'Recruteur' as const,
    departmentId: 'd1',
    mustChangePassword: false,
    avatarUrl: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const fill = (email: string, password: string) => {
    component.form.setValue({ email, password });
    fixture.detectChanges();
  };

  it('FR-1: renders an email field and a password field', () => {
    const inputs: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('input'),
    );

    expect(inputs.some((i) => i.getAttribute('type') === 'email')).toBeTrue();
    expect(inputs.some((i) => i.getAttribute('type') === 'password')).toBeTrue();
  });

  it('FR-1: does not call the API when the form is empty', () => {
    component.submit();

    http.expectNone(LOGIN_URL);
    expect(component.form.controls.email.touched).toBeTrue();
  });

  it('FR-1: does not call the API for a malformed email', () => {
    fill('pas-un-email', 'S3cret!Passw0rd');

    component.submit();

    http.expectNone(LOGIN_URL);
    expect(component.form.controls.email.hasError('email')).toBeTrue();
    expect(component.submitting()).toBeFalse();
  });

  it('D-001: sends credentials so the session cookie is stored', () => {
    fill('marie@example.com', 'S3cret!Passw0rd');
    component.submit();

    const req = http.expectOne(LOGIN_URL);
    // Session-based auth: without this the login authenticates nobody.
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.body).toEqual({
      email: 'marie@example.com',
      password: 'S3cret!Passw0rd',
    });
    req.flush(user);
  });

  it('navigates to the dashboard on success', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    fill('marie@example.com', 'S3cret!Passw0rd');
    component.submit();

    http.expectOne(LOGIN_URL).flush(user);

    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(TestBed.inject(AuthService).currentUser()?.name).toBe('Marie');
  });

  it('FR-3: shows the server’s single credential message and does NOT navigate', () => {
    const navigate = spyOn(router, 'navigate');
    fill('marie@example.com', 'mauvais');
    component.submit();

    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Email ou mot de passe incorrect');
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Email ou mot de passe incorrect');
  });

  it('FR-3: an unknown address produces the IDENTICAL message to a wrong password', () => {
    fill('inconnu@example.com', 'peu-importe');
    component.submit();
    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    const first = component.errorMessage();

    fill('marie@example.com', 'mauvais');
    component.submit();
    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    // The client must not re-introduce the enumeration leak the server avoids.
    expect(component.errorMessage()).toBe(first);
  });

  it('D-025: surfaces the rate-limit message rather than a generic failure', () => {
    fill('marie@example.com', 'mauvais');
    component.submit();

    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'TOO_MANY_REQUESTS', message: 'Trop de tentatives. Réessayez dans 15 minutes.' } },
      { status: 429, statusText: 'Too Many Requests' },
    );

    expect(component.errorMessage()).toContain('Trop de tentatives');
  });

  it('reports an unreachable server distinctly from bad credentials', () => {
    fill('marie@example.com', 'S3cret!Passw0rd');
    component.submit();

    http.expectOne(LOGIN_URL).error(new ProgressEvent('error'), { status: 0 });

    expect(component.errorMessage()).toContain('injoignable');
  });

  it('FR-10: a forced password change goes to the change-password screen', () => {
    const navigate = spyOn(router, 'navigate');
    fill('marie@example.com', 'TempPass123');
    component.submit();

    http.expectOne(LOGIN_URL).flush({ ...user, mustChangePassword: true });
    fixture.detectChanges();

    // This test used to assert the OPPOSITE — that the flow stopped here and
    // announced itself — which was right while no change-password screen
    // existed. FR-10 says « contraint de le changer à la prochaine connexion »,
    // and requireAuth 403s every protected route while the flag is set, so
    // stopping here is a dead end rather than a constraint (D-086).
    expect(navigate).toHaveBeenCalledWith(['/change-password']);
    expect(navigate).not.toHaveBeenCalledWith(['/dashboard']);
  });

  // Phase 4.1 items 1.1 to 1.4.
  describe('4.1 — the presentation pass', () => {
    it('1.4: the password field starts MASKED', () => {
      const field = fixture.nativeElement.querySelector(
        'input[formcontrolname=password]',
      ) as HTMLInputElement;

      expect(field.getAttribute('type')).toBe('password');
      expect(component.passwordVisible()).toBeFalse();
    });

    it('1.4: the toggle reveals it and keeps the typed value', () => {
      fill('marie@example.com', 'S3cret!Passw0rd');
      const field = () =>
        fixture.nativeElement.querySelector('input[formcontrolname=password]') as HTMLInputElement;

      const toggle = fixture.nativeElement.querySelector(
        'button[aria-label="Afficher le mot de passe"]',
      ) as HTMLButtonElement;
      expect(toggle).toBeTruthy();

      toggle.click();
      fixture.detectChanges();

      expect(field().getAttribute('type')).toBe('text');
      // `type` is BOUND rather than the attribute swapped, so the control must
      // not lose what was typed — the whole point on a screen where FR-10
      // hands people a 16-character string to retype.
      expect(field().value).toBe('S3cret!Passw0rd');
      expect(component.form.controls.password.value).toBe('S3cret!Passw0rd');
    });

    it('1.4: the toggle reports its state to a screen reader, and flips back', () => {
      const toggle = () =>
        fixture.nativeElement.querySelector(
          'button[aria-label="Afficher le mot de passe"], button[aria-label="Masquer le mot de passe"]',
        ) as HTMLButtonElement;

      expect(toggle().getAttribute('aria-pressed')).toBe('false');

      toggle().click();
      fixture.detectChanges();
      expect(toggle().getAttribute('aria-label')).toBe('Masquer le mot de passe');
      expect(toggle().getAttribute('aria-pressed')).toBe('true');

      toggle().click();
      fixture.detectChanges();
      // Before AND after: masked, revealed, masked again.
      expect(toggle().getAttribute('aria-label')).toBe('Afficher le mot de passe');
      expect(
        (fixture.nativeElement.querySelector('input[formcontrolname=password]') as HTMLInputElement)
          .getAttribute('type'),
      ).toBe('password');
    });

    it('1.4: revealing the password sends NO request', () => {
      fill('marie@example.com', 'S3cret!Passw0rd');

      (
        fixture.nativeElement.querySelector(
          'button[aria-label="Afficher le mot de passe"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      // The COUNT is the assertion: a bare verify() records none.
      expect(http.match(() => true).length).toBe(0);
    });

    it('1.1 / 1.2: the wordmark appears ONCE, and the card greets', () => {
      const text = fixture.nativeElement.textContent as string;

      expect(text).toContain('Bienvenue');
      expect(text).toContain('Solution de recrutement professionnelle');
      // It used to appear twice — logo block and card heading both said it.
      expect(text.split('RecrutPro').length - 1).toBe(1);
    });

    it('1.1: the brand block is OUTSIDE the card', () => {
      const card = fixture.nativeElement.querySelector('.login__card') as HTMLElement;
      const brand = fixture.nativeElement.querySelector('.brand') as HTMLElement;

      expect(brand).toBeTruthy();
      expect(card.contains(brand)).toBeFalse();
    });

    it('1.3: each field carries a leading glyph', () => {
      const prefixes = Array.from(
        fixture.nativeElement.querySelectorAll('mat-icon[matPrefix], [matprefix]'),
      ).map((el) => (el as HTMLElement).textContent?.trim());

      expect(prefixes).toContain('mail');
      expect(prefixes).toContain('lock');
    });
  });

  it('re-enables the submit button after a failure', () => {
    fill('marie@example.com', 'mauvais');
    component.submit();
    expect(component.submitting()).toBeTrue();

    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    // A form that stays disabled after a wrong password is unusable.
    expect(component.submitting()).toBeFalse();
  });

  it('clears a previous error when a new attempt starts', () => {
    fill('marie@example.com', 'mauvais');
    component.submit();
    http.expectOne(LOGIN_URL).flush(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    expect(component.errorMessage()).not.toBeNull();

    component.submit();
    expect(component.errorMessage()).toBeNull();
    http.expectOne(LOGIN_URL).flush(user);
  });
});

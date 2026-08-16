import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ResetPassword } from './reset-password';
import { environment } from '../../../../environments/environment';

/**
 * FR-10 / D-031 — the one credential this system ever displays.
 *
 * Every assertion here is about handling it correctly: nothing sensitive before
 * an explicit confirmation, the value shown exactly as the server sent it, the
 * irreversibility stated, and nothing left behind afterwards.
 */
describe('ResetPassword (FR-10, D-031)', () => {
  let fixture: ComponentFixture<ResetPassword>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/users/${ID}/reset-password`;
  const TEMP = 'xQ7-tR2nP9wKm3Zv';

  const open = (): void => {
    fixture = TestBed.createComponent(ResetPassword);
    fixture.componentRef.setInput('userId', ID);
    fixture.componentRef.setInput('userName', 'Marie Dupont');
    fixture.componentRef.setInput('userEmail', 'marie@example.com');
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  const generate = (): void => {
    buttonLabelled('Générer le mot de passe')!.click();
    http.expectOne(URL).flush({ user: { id: ID }, temporaryPassword: TEMP });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResetPassword],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('Before: nothing sensitive is on screen, and nothing has happened', () => {
    it('issues NO request when it opens', () => {
      open();
      // A one-click reset would put a live credential on a screen nobody was
      // looking at, and the value cannot be re-fetched afterwards.
      expect(http.match(() => true).length).toBe(0);
      expect(fixture.nativeElement.querySelector('.secret')).toBeNull();
    });

    it('warns that the value is shown once, BEFORE generating it', () => {
      open();

      expect(text()).toContain('une seule fois');
      expect(text()).toContain('Marie Dupont');
      expect(text()).toContain('marie@example.com');
    });

    it('dismissing does not touch the server', () => {
      const dismissed: number[] = [];
      open();
      fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

      buttonLabelled('Annuler')!.click();

      expect(dismissed.length).toBe(1);
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('The request', () => {
    it('POSTs with the session cookie and an empty body', () => {
      open();
      buttonLabelled('Générer le mot de passe')!.click();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      // The server generates it; a client-supplied password would defeat D-031.
      expect(req.request.body).toEqual({});

      req.flush({ user: { id: ID }, temporaryPassword: TEMP });
    });
  });

  describe('After: the value, shown exactly once', () => {
    it("renders the server's password EXACTLY, not a re-derived one", () => {
      open();
      generate();

      const secret = fixture.nativeElement.querySelector('.secret__value') as HTMLElement;
      // Exact equality, not `toContain`: a substring check would pass on a
      // truncated or re-encoded value, which is unusable when transcribed.
      expect(secret.textContent!.trim()).toBe(TEMP);
    });

    it('is NOT in an input, so no browser offers to save it', () => {
      open();
      generate();

      // It is selectable text. An <input value=…> is what a password manager
      // and an autofill heuristic both reach for.
      expect(fixture.nativeElement.querySelectorAll('input').length).toBe(0);
    });

    it('states that closing loses it, and that the holder must change it', () => {
      open();
      generate();

      expect(text()).toContain('Notez-le maintenant');
      expect(text()).toContain('ne pourra pas être réaffiché');
      expect(text()).toContain('première connexion');
    });

    it('the generate button is GONE — a second click would issue a second one', () => {
      open();
      generate();

      expect(buttonLabelled('Générer le mot de passe')).toBeUndefined();
      // …and a programmatic re-submit sends nothing either.
      fixture.componentInstance.submit();
      expect(http.match(() => true).length).toBe(0);
    });

    it('closing emits `finished`, not `dismissed` — the reset really happened', () => {
      const finished: number[] = [];
      const dismissed: number[] = [];
      open();
      fixture.componentInstance.finished.subscribe(() => finished.push(1));
      fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

      generate();
      buttonLabelled("J'ai noté le mot de passe")!.click();

      // The page must re-read the account: mustChangePassword has flipped.
      expect(finished.length).toBe(1);
      expect(dismissed.length).toBe(0);
    });
  });

  describe('Failure', () => {
    it("shows the server's message and reveals nothing", () => {
      open();
      buttonLabelled('Générer le mot de passe')!.click();
      http.expectOne(URL).flush(
        { error: { code: 'NOT_FOUND', message: "Cet utilisateur n'existe pas." } },
        { status: 404, statusText: 'Not Found' },
      );
      fixture.detectChanges();

      expect(text()).toContain("Cet utilisateur n'existe pas.");
      expect(fixture.nativeElement.querySelector('.secret')).toBeNull();
      // Still offering to try, since nothing was consumed.
      expect(buttonLabelled('Générer le mot de passe')).toBeTruthy();
    });

    it('reports an unreachable server', () => {
      open();
      buttonLabelled('Générer le mot de passe')!.click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
      expect(fixture.nativeElement.querySelector('.secret')).toBeNull();
    });
  });
});

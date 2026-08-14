import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CvReview } from './cv-review';
import { environment } from '../../../../environments/environment';

/**
 * FR-25 / FR-26 — the Recruteur's CV preselection.
 *
 * The bulk of this file is about ONE rule and its inverse: `rejectionReason` is
 * mandatory on « Rejeté (CV) » and FORBIDDEN on « Présélection CV validée »
 * (D-042). The final decision dialog requires its comment on BOTH outcomes
 * (D-051), so these are the assertions that stop the two drifting together.
 */
describe('CvReview (FR-25, FR-26)', () => {
  let fixture: ComponentFixture<CvReview>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/candidates/${ID}/stage`;

  const open = (resumeUrl: string | null = `/api/v1/candidates/${ID}/resume`): void => {
    fixture = TestBed.createComponent(CvReview);
    fixture.componentRef.setInput('candidateId', ID);
    fixture.componentRef.setInput('candidateName', 'Jean Martin');
    fixture.componentRef.setInput('resumeUrl', resumeUrl);
    fixture.detectChanges();
  };

  /** `textContent`, never `innerText` — the chips and legend are uppercased. */
  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  const choose = (value: string): void => {
    const radio = fixture.nativeElement.querySelector(
      `input[type=radio][value="${value}"]`,
    ) as HTMLInputElement;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  };

  const reasonField = (): HTMLTextAreaElement | null =>
    fixture.nativeElement.querySelector('#cv-review-reason');

  const typeReason = (value: string): void => {
    const el = reasonField()!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CvReview],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('No new endpoint — the shared stage route', () => {
    it('issues NO request when it opens', () => {
      open();
      http.verify();
    });

    it('offers exactly the two CV-review outcomes, and neither final-decision stage', () => {
      open();

      const radios = Array.from(
        fixture.nativeElement.querySelectorAll('input[type=radio]'),
      ) as HTMLInputElement[];
      expect(radios.map((r) => r.value)).toEqual(['Présélection CV validée', 'Rejeté (CV)']);
      // The Responsable's transitions travel the same route and must not
      // appear here (D-042 / D-051).
      expect(text()).not.toContain('Accepté');
      // « Rejeté (CV) » contains "Rejeté", so assert on the chips instead.
      const chips = Array.from(
        fixture.nativeElement.querySelectorAll('app-stage-chip .chip'),
      ) as HTMLElement[];
      expect(chips.map((c) => c.textContent)).toEqual(['Présélection CV validée', 'Rejeté (CV)']);
    });

    it('renders both outcomes through StageChip, with the shared tones', () => {
      open();

      const chips = Array.from(
        fixture.nativeElement.querySelectorAll('app-stage-chip .chip'),
      ) as HTMLElement[];
      // « Présélection CV validée » is an in-progress state, not a positive
      // terminal — D-066 reserves the success token for a settled good outcome.
      expect(chips[0].className).toContain('chip--info');
      expect(chips[1].className).toContain('chip--negative');
    });

    it('D-040: the CV link is this API proxy route, never a storage URL', () => {
      open();

      const link = fixture.nativeElement.querySelector('a[href*="/resume"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/api/v1/candidates/${ID}/resume`);
      expect(fixture.nativeElement.innerHTML).not.toContain('cloudinary');
    });

    it('says so when there is no CV to read', () => {
      open(null);

      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeNull();
      expect(text()).toContain("Aucun CV n'est joint");
    });

    it('warns that the decision is one-way', () => {
      open();
      expect(text()).toContain('définitive');
    });
  });

  describe('FR-26 — the motive is required on REJECTION only', () => {
    it('shows NO motive field until an outcome is chosen', () => {
      open();
      expect(reasonField()).toBeNull();
      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
    });

    it('shows NO motive field on a VALIDATION — the server forbids one there', () => {
      open();
      choose('Présélection CV validée');

      // This is the inverse of the FR-29 dialog, and the assertion that keeps
      // them from converging: a field here would invite a 400.
      expect(reasonField()).toBeNull();
      expect(buttonLabelled('Confirmer la décision').disabled).toBeFalse();
    });

    it('SHOWS the motive field on a rejection, and blocks until it is filled', () => {
      open();
      choose('Rejeté (CV)');

      expect(reasonField()).toBeTruthy();
      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
      expect(text()).toContain('Un motif est obligatoire');

      typeReason('Profil trop junior pour le poste.');
      expect(buttonLabelled('Confirmer la décision').disabled).toBeFalse();
    });

    it('blocks on a WHITESPACE-ONLY motive', () => {
      open();
      choose('Rejeté (CV)');
      typeReason('     ');

      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
    });

    it('switching back to a validation DISCARDS the typed motive', () => {
      open();
      choose('Rejeté (CV)');
      typeReason('Profil trop junior.');

      choose('Présélection CV validée');
      expect(reasonField()).toBeNull();
      expect(fixture.componentInstance.reason()).toBe('');

      // The point of discarding: a retained motive would be sent on the pass
      // and refused with a 400 whose cause is no longer on screen.
      buttonLabelled('Confirmer la décision').click();
      const req = http.expectOne(URL);
      expect('rejectionReason' in (req.request.body as object)).toBeFalse();
      req.flush({ id: ID, currentStage: 'Présélection CV validée' });
    });
  });

  describe('FR-25 — the request', () => {
    it('a VALIDATION sends targetStage alone — no rejectionReason key at all', () => {
      open();
      choose('Présélection CV validée');

      buttonLabelled('Confirmer la décision').click();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({ targetStage: 'Présélection CV validée' });
      // Not `rejectionReason: undefined`, not `''` — absent. D-042 refuses a
      // motive on a pass, and an empty string is a value.
      expect('rejectionReason' in (req.request.body as object)).toBeFalse();
      // And never the FR-29 field, which belongs to the other role's transition.
      expect('decisionComment' in (req.request.body as object)).toBeFalse();

      req.flush({ id: ID, currentStage: 'Présélection CV validée' });
    });

    it('a REJECTION sends the trimmed motive', () => {
      open();
      choose('Rejeté (CV)');
      typeReason('   Profil trop junior pour le poste.   ');

      buttonLabelled('Confirmer la décision').click();

      const req = http.expectOne(URL);
      expect(req.request.body).toEqual({
        targetStage: 'Rejeté (CV)',
        rejectionReason: 'Profil trop junior pour le poste.',
      });
      req.flush({ id: ID, currentStage: 'Rejeté (CV)' });
    });

    it('emits `reviewed` on success', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.reviewed.subscribe(() => emitted.push(1));
      choose('Présélection CV validée');

      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).flush({ id: ID, currentStage: 'Présélection CV validée' });

      expect(emitted.length).toBe(1);
    });

    it('a programmatic submit past the disabled button still sends nothing', () => {
      open();
      choose('Rejeté (CV)');

      fixture.componentInstance.submit();

      http.verify();
    });
  });

  describe('The SERVER half still reaches the reader', () => {
    const failsWith = (code: string, message: string, status: number): void => {
      choose('Présélection CV validée');
      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).flush({ error: { code, message } }, { status, statusText: 'Error' });
      fixture.detectChanges();
    };

    it('REJECTION_REASON_REQUIRED is shown verbatim and nothing is emitted', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.reviewed.subscribe(() => emitted.push(1));

      failsWith(
        'REJECTION_REASON_REQUIRED',
        'Un motif de rejet est obligatoire pour rejeter un candidat à la présélection CV.',
        400,
      );

      expect(text()).toContain('Un motif de rejet est obligatoire');
      expect(emitted.length).toBe(0);
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    });

    it("D-042: the server's refusal of a motive on a PASS is surfaced", () => {
      open();
      failsWith(
        'VALIDATION_ERROR',
        "Un motif de rejet ne peut pas accompagner une présélection validée. Retirez « rejectionReason ».",
        400,
      );

      expect(text()).toContain('ne peut pas accompagner une présélection validée');
    });

    it('D-042: the ONE-WAY refusal is reported, not retried silently', () => {
      open();
      failsWith(
        'INVALID_STAGE_TRANSITION',
        "La présélection CV ne s'applique qu'à un candidat à l'étape « Candidature reçue » : cette décision a déjà été prise.",
        409,
      );

      expect(text()).toContain('cette décision a déjà été prise');
    });

    it('a 403 is shown, not swallowed', () => {
      open();
      failsWith('FORBIDDEN', "Votre rôle ne vous autorise pas à accéder à cette ressource.", 403);

      expect(text()).toContain('Votre rôle ne vous autorise pas');
    });

    it('reports an unreachable server rather than appearing to have worked', () => {
      open();
      choose('Présélection CV validée');
      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('changing the outcome clears a stale server message', () => {
      open();
      failsWith('INVALID_STAGE_TRANSITION', 'Étape incorrecte.', 409);
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeTruthy();

      choose('Rejeté (CV)');

      expect(fixture.nativeElement.querySelector('.modal__error')).toBeNull();
    });
  });

  it('dismisses without touching the server', () => {
    const dismissed: number[] = [];
    open();
    fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

    buttonLabelled('Retour').click();

    expect(dismissed.length).toBe(1);
    http.verify();
  });
});

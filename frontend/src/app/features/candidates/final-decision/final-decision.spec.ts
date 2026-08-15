import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FinalDecision } from './final-decision';
import { environment } from '../../../../environments/environment';

/**
 * FR-29 / FR-39 — the final decision.
 *
 * FR-29's comment is asserted from BOTH sides: that the client blocks an empty
 * one, and that when the server refuses one anyway its message reaches the
 * reader. A client-side block that hides a server rule is how the rule stops
 * being tested.
 */
describe('FinalDecision (FR-29, FR-39)', () => {
  let fixture: ComponentFixture<FinalDecision>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/candidates/${ID}/stage`;

  const open = (): void => {
    fixture = TestBed.createComponent(FinalDecision);
    fixture.componentRef.setInput('candidateId', ID);
    fixture.componentRef.setInput('candidateName', 'Jean Martin');
    fixture.detectChanges();
  };

  /**
   * `textContent`, never `innerText`. The chips and the legend are uppercased
   * by CSS, so `innerText` reports « ACCEPTÉ » while the source says
   * « Accepté » — the trap this session has now hit twice.
   */
  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  const chooseOutcome = (value: string): void => {
    const radio = fixture.nativeElement.querySelector(
      `input[type=radio][value="${value}"]`,
    ) as HTMLInputElement;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  };

  const typeComment = (value: string): void => {
    const textarea = fixture.nativeElement.querySelector(
      '#decision-comment',
    ) as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinalDecision],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('No new endpoint — the shared stage route', () => {
    it('issues NO request when it opens', () => {
      open();
      // The COUNT is the assertion. A bare `http.verify()` throws on a stray
      // request but records no Jasmine expectation, so Karma reports the spec
      // as asserting nothing — and deleting the line would leave a test that
      // could never fail.
      expect(http.match(() => true).length).toBe(0);
    });

    it('offers exactly the two terminal outcomes, and no third', () => {
      open();

      const radios = Array.from(
        fixture.nativeElement.querySelectorAll('input[type=radio]'),
      ) as HTMLInputElement[];
      expect(radios.map((r) => r.value)).toEqual(['Accepté', 'Rejeté']);
      // The Recruteur's own transitions travel the same route and must not
      // appear here (D-051).
      expect(text()).not.toContain('Présélection CV validée');
      expect(text()).not.toContain('Rejeté (CV)');
    });

    it('renders each outcome through StageChip, so the colours are the shared ones', () => {
      open();

      const chips = fixture.nativeElement.querySelectorAll('app-stage-chip .chip');
      expect(chips.length).toBe(2);
      // D-066's tones: the positive terminal and the negative terminal.
      expect((chips[0] as HTMLElement).className).toContain('chip--positive');
      expect((chips[1] as HTMLElement).className).toContain('chip--negative');
      expect((chips[0] as HTMLElement).textContent).toBe('Accepté');
      expect((chips[1] as HTMLElement).textContent).toBe('Rejeté');
    });

    it('warns that the decision is irreversible', () => {
      open();
      expect(text()).toContain('définitive');
    });
  });

  describe('FR-29 — the comment is mandatory for BOTH outcomes', () => {
    it('blocks with no outcome and no comment', () => {
      open();
      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
    });

    it('blocks with an outcome but no comment — including for « Accepté »', () => {
      open();
      chooseOutcome('Accepté');

      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
      expect(text()).toContain('y compris pour une décision favorable');
    });

    it('blocks with a comment but no outcome', () => {
      open();
      typeComment('Bon profil.');

      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
      expect(text()).toContain('Choisissez une issue');
    });

    it('blocks on a WHITESPACE-ONLY comment — a comment of spaces is not a comment', () => {
      open();
      chooseOutcome('Rejeté');
      typeComment('     ');

      expect(buttonLabelled('Confirmer la décision').disabled).toBeTrue();
    });

    it('allows submission once both are present, for either outcome', () => {
      for (const outcome of ['Accepté', 'Rejeté']) {
        open();
        chooseOutcome(outcome);
        typeComment('Décision motivée.');
        expect(buttonLabelled('Confirmer la décision').disabled)
          .withContext(outcome)
          .toBeFalse();
      }
    });

    it('a programmatic submit past the disabled button still sends nothing', () => {
      open();
      chooseOutcome('Accepté');

      fixture.componentInstance.submit();

      // An explicit count, not a bare verify() Jasmine cannot see.
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('FR-39 — the request', () => {
    it('PATCHes the shared stage route with the outcome and a trimmed comment', () => {
      open();
      chooseOutcome('Accepté');
      typeComment('  Excellent profil, offre envoyée.  ');

      buttonLabelled('Confirmer la décision').click();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({
        targetStage: 'Accepté',
        decisionComment: 'Excellent profil, offre envoyée.',
      });
      // No rejectionReason: that is the Recruteur's FR-26 field on the same
      // route, and sending it here would be a different transition.
      expect('rejectionReason' in (req.request.body as object)).toBeFalse();

      req.flush({ id: ID, currentStage: 'Accepté' });
    });

    it('sends « Rejeté » with its comment too', () => {
      open();
      chooseOutcome('Rejeté');
      typeComment('Profil intéressant mais séniorité insuffisante.');

      buttonLabelled('Confirmer la décision').click();

      const req = http.expectOne(URL);
      expect((req.request.body as { targetStage: string }).targetStage).toBe('Rejeté');
      expect((req.request.body as { decisionComment: string }).decisionComment).toBe(
        'Profil intéressant mais séniorité insuffisante.',
      );
      req.flush({ id: ID, currentStage: 'Rejeté' });
    });

    it('emits `decided` on success', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.decided.subscribe(() => emitted.push(1));
      chooseOutcome('Accepté');
      typeComment('Recruté.');

      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).flush({ id: ID, currentStage: 'Accepté' });

      expect(emitted.length).toBe(1);
    });
  });

  describe('FR-29 — the SERVER half still reaches the reader', () => {
    const failsWith = (code: string, message: string, status: number): void => {
      chooseOutcome('Accepté');
      typeComment('Un commentaire.');
      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).flush({ error: { code, message } }, { status, statusText: 'Error' });
      fixture.detectChanges();
    };

    it('DECISION_COMMENT_REQUIRED is shown verbatim and nothing is emitted', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.decided.subscribe(() => emitted.push(1));

      failsWith(
        'DECISION_COMMENT_REQUIRED',
        'Un commentaire est obligatoire pour la décision finale.',
        400,
      );

      expect(text()).toContain('Un commentaire est obligatoire pour la décision finale.');
      expect(emitted.length).toBe(0);
      // The dialog stays open so the work is not lost.
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    });

    it('D-051: a wrong stage is reported, not retried silently', () => {
      open();
      failsWith(
        'INVALID_STAGE_TRANSITION',
        "La décision finale n'est possible qu'à partir de l'étape « Évaluation complétée ».",
        409,
      );

      expect(text()).toContain('« Évaluation complétée »');
    });

    it('D-051: a 403 from the assignment predicate is shown, not swallowed', () => {
      open();
      failsWith(
        'FORBIDDEN',
        "Vous ne pouvez décider que des candidats dont vous avez mené l'entretien.",
        403,
      );

      expect(text()).toContain("dont vous avez mené l'entretien");
    });

    it('reports an unreachable server rather than appearing to have worked', () => {
      open();
      chooseOutcome('Rejeté');
      typeComment('Non retenu.');
      buttonLabelled('Confirmer la décision').click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('changing the outcome clears a stale server message about the old attempt', () => {
      open();
      failsWith('INVALID_STAGE_TRANSITION', 'Étape incorrecte.', 409);
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeTruthy();

      chooseOutcome('Rejeté');

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

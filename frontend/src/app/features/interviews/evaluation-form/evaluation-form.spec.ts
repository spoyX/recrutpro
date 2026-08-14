import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EvaluationForm } from './evaluation-form';
import { InterviewListItem } from '../interview.service';
import { environment } from '../../../../environments/environment';

/**
 * FR-36 / FR-37 — the evaluation form.
 *
 * FR-37 is asserted from BOTH sides here: that the client blocks a partial
 * form, and that when the server refuses one anyway its message reaches the
 * reader. A client-side block that hides a server rule is how the rule stops
 * being tested.
 */
describe('EvaluationForm (FR-36, FR-37)', () => {
  let fixture: ComponentFixture<EvaluationForm>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/interviews/${ID}/evaluation`;

  /** A slot in the past — FR-36's « après un entretien ». */
  const row: InterviewListItem = {
    id: ID,
    scheduledAt: '2026-08-10T14:00:00.000Z',
    status: 'Planifié',
    candidate: {
      id: 'c1',
      fullName: 'Jean Martin',
      hasResume: true,
      resumeUrl: '/api/v1/candidates/c1/resume',
    },
    jobPosition: { id: 'p1', title: 'Développeur backend' },
    interviewer: { id: 'u2', name: 'Pierre' },
    cancellationReason: null,
  };

  const open = (overrides: Partial<InterviewListItem> = {}): void => {
    fixture = TestBed.createComponent(EvaluationForm);
    fixture.componentRef.setInput('interview', { ...row, ...overrides });
    fixture.detectChanges();
  };

  /**
   * `textContent`, never `innerText`. `.label-sm` sets `text-transform:
   * uppercase` on every criterion legend, so `innerText` would report
   * « COMPÉTENCES TECHNIQUES » and a source-cased assertion would fail against
   * a perfectly correct render.
   */
  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  const stepsFor = (criterion: string): HTMLInputElement[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll(`input[type=radio][name="${criterion}"]`),
    ) as HTMLInputElement[];

  const score = (criterion: string, value: number): void => {
    stepsFor(criterion)[value - 1].dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  };

  const scoreAll = (a = 4, b = 5, c = 3): void => {
    score('technicalSkills', a);
    score('communication', b);
    score('overallFit', c);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EvaluationForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('No new endpoint — the row is the payload', () => {
    it('issues NO request when it opens, so `GET /interviews/:id` is not needed', () => {
      open();

      // The check that decided the design: everything below renders from the
      // FR-35 list row the caller already had.
      http.verify();
      expect(text()).toContain('Jean Martin');
      expect(text()).toContain('Développeur backend');
    });

    it('renders the slot as LOCAL time, not the UTC string', () => {
      open();

      const at = new Date(row.scheduledAt);
      const pad = (n: number): string => String(n).padStart(2, '0');
      const expected =
        `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} à ` +
        `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      expect(text().replace(/\s+/g, ' ')).toContain(expected);
    });

    it('FR-35 / D-040: the CV link is this API proxy route, never a storage URL', () => {
      open();

      const link = fixture.nativeElement.querySelector('a[href*="/resume"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/api/v1/candidates/c1/resume');
      expect(fixture.nativeElement.innerHTML).not.toContain('cloudinary');
    });

    it('offers no CV link when there is none', () => {
      open({ candidate: { ...row.candidate!, hasResume: false } });

      expect(fixture.nativeElement.querySelector('a[href*="/resume"]')).toBeNull();
    });
  });

  describe('FR-36 — three criteria on a five-point scale', () => {
    it('renders exactly three criteria, each with exactly five steps', () => {
      open();

      expect(fixture.nativeElement.querySelectorAll('fieldset.criterion').length).toBe(3);
      for (const criterion of ['technicalSkills', 'communication', 'overallFit']) {
        expect(stepsFor(criterion).length)
          .withContext(criterion)
          .toBe(5);
      }
    });

    it('labels them in French, and the source casing survives `textContent`', () => {
      open();

      // Uppercased on screen by `.label-sm`; these are the SOURCE strings.
      expect(text()).toContain('Compétences techniques');
      expect(text()).toContain('Communication');
      expect(text()).toContain('Adéquation globale');
    });

    it('starts with NO score pre-selected — a default is an opinion nobody gave', () => {
      open();

      const checked = fixture.nativeElement.querySelectorAll('input[type=radio]:checked');
      expect(checked.length).toBe(0);
      expect(fixture.nativeElement.querySelectorAll('.criterion__step--on').length).toBe(0);
    });

    it('marks exactly the chosen step, and replaces it rather than adding one', () => {
      open();

      score('technicalSkills', 4);
      expect(fixture.nativeElement.querySelectorAll('.criterion__step--on').length).toBe(1);

      score('technicalSkills', 2);
      expect(fixture.nativeElement.querySelectorAll('.criterion__step--on').length).toBe(1);
      expect(stepsFor('technicalSkills')[1].checked).toBeTrue();
    });
  });

  describe('FR-37 — the client half of the block', () => {
    it('the submit button is disabled while ANY score is missing', () => {
      open();
      expect(buttonLabelled("Soumettre l'évaluation").disabled).toBeTrue();

      score('technicalSkills', 4);
      expect(buttonLabelled("Soumettre l'évaluation").disabled).toBeTrue();

      score('communication', 5);
      expect(buttonLabelled("Soumettre l'évaluation").disabled).toBeTrue();

      score('overallFit', 3);
      expect(buttonLabelled("Soumettre l'évaluation").disabled).toBeFalse();
    });

    it('SAYS which notes are missing — a dim button with no reason is its own defect', () => {
      open();

      expect(text()).toContain('Compétences techniques');
      // Case-insensitive on BOTH sides. Lowercasing only the needle is how a
      // case-insensitive check quietly becomes a case-sensitive one.
      expect(text().toLowerCase()).toContain('il en manque 3');

      score('technicalSkills', 4);
      score('communication', 5);

      const note = fixture.nativeElement.querySelector('.evaluation__missing') as HTMLElement;
      expect(note.textContent).toContain('Adéquation globale');
      expect(note.textContent).not.toContain('Communication');
    });

    it('the explanation disappears once the form is complete', () => {
      open();
      scoreAll();

      expect(fixture.nativeElement.querySelector('.evaluation__missing')).toBeNull();
    });

    it('clicking through a disabled button still sends nothing', () => {
      open();
      score('technicalSkills', 4);

      // Belt and braces: the guard in submit(), not just the disabled attribute.
      fixture.componentInstance.submit();

      http.verify();
    });
  });

  describe('FR-36 — the request', () => {
    it('sends the three scores as NUMBERS, and omits an empty comment', () => {
      open();
      scoreAll(4, 5, 3);

      buttonLabelled("Soumettre l'évaluation").click();

      const req = http.expectOne(URL);
      const body = req.request.body as { scores: Record<string, unknown>; comments?: unknown };
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(body.scores).toEqual({ technicalSkills: 4, communication: 5, overallFit: 3 });
      // Numbers, not strings: the server integer-checks them (D-048), and a
      // string would be refused for the wrong reason.
      for (const value of Object.values(body.scores)) {
        expect(typeof value).toBe('number');
      }
      // FR-36 makes the comment optional; '' is a value, not an absence.
      expect('comments' in body).toBeFalse();

      req.flush({ id: 'e1' });
    });

    it('sends a trimmed comment when there is one', () => {
      open();
      scoreAll();
      const textarea = fixture.nativeElement.querySelector('#evaluation-comments') as HTMLTextAreaElement;
      textarea.value = '  Très bonne maîtrise technique.  ';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      buttonLabelled("Soumettre l'évaluation").click();

      const req = http.expectOne(URL);
      expect((req.request.body as { comments: string }).comments).toBe(
        'Très bonne maîtrise technique.',
      );
      req.flush({ id: 'e1' });
    });

    it('a whitespace-only comment is omitted, not sent as blank', () => {
      open();
      scoreAll();
      const textarea = fixture.nativeElement.querySelector('#evaluation-comments') as HTMLTextAreaElement;
      textarea.value = '   ';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      buttonLabelled("Soumettre l'évaluation").click();

      const req = http.expectOne(URL);
      expect('comments' in (req.request.body as object)).toBeFalse();
      req.flush({ id: 'e1' });
    });

    it('emits `submitted` on success, so the caller can reload', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.submitted.subscribe(() => emitted.push(1));
      scoreAll();

      buttonLabelled("Soumettre l'évaluation").click();
      http.expectOne(URL).flush({ id: 'e1' });

      expect(emitted.length).toBe(1);
    });
  });

  describe('FR-37 — the SERVER half still reaches the reader', () => {
    const failsWith = (code: string, message: string, status: number): void => {
      scoreAll();
      buttonLabelled("Soumettre l'évaluation").click();
      http.expectOne(URL).flush({ error: { code, message } }, { status, statusText: 'Error' });
      fixture.detectChanges();
    };

    it('MISSING_REQUIRED_SCORES is shown verbatim, and nothing is emitted', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.submitted.subscribe(() => emitted.push(1));

      failsWith(
        'MISSING_REQUIRED_SCORES',
        'Toutes les notes sont obligatoires. Manquant : communication.',
        400,
      );

      expect(text()).toContain('Toutes les notes sont obligatoires. Manquant : communication.');
      expect(emitted.length).toBe(0);
      // The dialog stays open so the work is not lost.
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    });

    it('D-048: an already-evaluated interview is reported, not retried silently', () => {
      open();
      failsWith(
        'EVALUATION_ALREADY_SUBMITTED',
        'Une évaluation a déjà été soumise pour cet entretien.',
        409,
      );

      expect(text()).toContain('Une évaluation a déjà été soumise');
    });

    it("D-048: an interview that hasn't happened yet is reported", () => {
      open();
      failsWith(
        'INTERVIEW_NOT_HELD_YET',
        "Cet entretien n'a pas encore eu lieu.",
        409,
      );

      expect(text()).toContain("n'a pas encore eu lieu");
    });

    it('D-048: a 403 from the assignment predicate is shown, not swallowed', () => {
      open();
      failsWith(
        'FORBIDDEN',
        'Vous ne pouvez évaluer que les entretiens qui vous sont assignés.',
        403,
      );

      expect(text()).toContain('qui vous sont assignés');
    });

    it('reports an unreachable server rather than appearing to have worked', () => {
      open();
      scoreAll();
      buttonLabelled("Soumettre l'évaluation").click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('changing a score clears a stale server message about the old form', () => {
      open();
      failsWith('MISSING_REQUIRED_SCORES', 'Manquant : communication.', 400);
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeTruthy();

      score('communication', 2);

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

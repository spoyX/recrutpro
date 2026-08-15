import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReplaceResume } from './replace-resume';
import { environment } from '../../../../environments/environment';

/**
 * FR-22 — replacing a CV.
 *
 * The assertions that matter are about what this dialog must NOT do: inspect
 * the file itself (D-007's real gate is the server's magic-byte test), invent a
 * storage URL (D-040), or imply that a refused upload cost the candidate their
 * existing CV (it cannot — the service stores the new bytes before touching
 * the old asset).
 */
describe('ReplaceResume (FR-22)', () => {
  let fixture: ComponentFixture<ReplaceResume>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/candidates/${ID}/resume`;

  const open = (hasExisting = true): void => {
    fixture = TestBed.createComponent(ReplaceResume);
    fixture.componentRef.setInput('candidateId', ID);
    fixture.componentRef.setInput('candidateName', 'Jean Martin');
    fixture.componentRef.setInput('hasExisting', hasExisting);
    fixture.detectChanges();
  };

  /** `textContent`, never `innerText` — the labels are uppercased by CSS. */
  const text = (): string => fixture.nativeElement.textContent as string;

  const fileInput = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('#replace-resume-file');

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  /** Drives the component's own handler — a file input's value is read-only. */
  const choose = (name: string, type = 'application/pdf'): File => {
    const file = new File([new Uint8Array([1, 2, 3])], name, { type });
    fixture.componentInstance.chooseFile({ 0: file, length: 1, item: () => file } as never);
    fixture.detectChanges();
    return file;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplaceResume],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('No new endpoint — the same route FR-21 uses', () => {
    it('issues NO request when it opens', () => {
      open();
      // The COUNT is the assertion: a bare verify() records none, which Karma
      // reports as a spec that asserts nothing.
      expect(http.match(() => true).length).toBe(0);
    });

    it('POSTs multipart to the candidate resume route, with the session cookie', () => {
      open();
      const file = choose('cv.pdf');

      buttonLabelled('Remplacer le CV').click();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.reportProgress).toBeTrue();

      const body = req.request.body as FormData;
      expect(body instanceof FormData).toBeTrue();
      // Identity, not reference: FormData.append with an explicit filename
      // hands back a NEW File object, so `toBe` compares two distinct wrappers
      // around the same bytes and always fails.
      const sent = body.get('file') as File;
      expect(sent.name).toBe(file.name);
      expect(sent.size).toBe(file.size);
      expect(sent.type).toBe(file.type);
      // The server takes the id from the path; a body copy would be a second
      // source of truth for the same fact.
      expect(body.get('candidateId')).toBeNull();

      req.flush({ id: 'r1' });
    });
  });

  describe('D-007 / D-040 — what this dialog must NOT do', () => {
    it('sends a MISNAMED file to the server rather than rejecting it locally', () => {
      open();
      // An executable claiming to be a PDF. `File.type` is the extension's
      // claim, so a client-side check would pass it anyway — the magic-byte
      // test is the real gate and it lives on the server.
      choose('malware.pdf', 'application/pdf');

      expect(buttonLabelled('Remplacer le CV').disabled).toBeFalse();
      buttonLabelled('Remplacer le CV').click();

      http.expectOne(URL).flush({ id: 'r1' });
    });

    it('does not block an unexpected MIME type either', () => {
      open();
      choose('notes.txt', 'text/plain');

      expect(buttonLabelled('Remplacer le CV').disabled).toBeFalse();
      buttonLabelled('Remplacer le CV').click();
      http.expectOne(URL).flush({ id: 'r1' });
    });

    it('states the limits as GUIDANCE, and `accept` is a picker hint only', () => {
      open();

      expect(text()).toContain('PDF ou DOCX');
      expect(text()).toContain('5 Mo');
      expect(fileInput().getAttribute('accept')).toBe('.pdf,.docx');
    });

    it('never renders a storage URL, even after a successful upload', () => {
      open();
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      // Even if the server were to leak one, nothing here renders it.
      http.expectOne(URL).flush({ id: 'r1', fileUrl: 'https://res.cloudinary.com/leak.pdf' });
      fixture.detectChanges();

      expect(fixture.nativeElement.innerHTML).not.toContain('cloudinary');
    });
  });

  describe('The wording follows the state, the endpoint does not', () => {
    it('replacing warns that the old file goes, and promises it survives a failure', () => {
      open(true);

      expect(text()).toContain('définitive');
      expect(text()).toContain("n'est plus téléchargeable");
      // The safety promise is a real property of the service: the new bytes are
      // stored before the old asset is destroyed.
      expect(text()).toContain('le CV actuel reste en place');
    });

    it('a FIRST upload makes neither claim — there is nothing to lose', () => {
      open(false);

      // Lower-case 'a': the sentence continues after the em dash. Asserting
      // the capitalised form matched nothing and said the copy was missing.
      expect(text()).toContain("aucun CV n'est joint");
      expect(text()).not.toContain('définitive');
      expect(fixture.nativeElement.querySelector('.resume__safety')).toBeNull();
      expect(buttonLabelled('Téléverser')).toBeTruthy();
    });

    it('hits the SAME url either way', () => {
      open(false);
      choose('cv.pdf');
      buttonLabelled('Téléverser').click();

      const req = http.expectOne(URL);
      // An explicit expectation: expectOne throws on a miss but records none,
      // so on its own Jasmine reports the spec as asserting nothing.
      expect(req.request.url).toBe(URL);
      req.flush({ id: 'r1' });
    });
  });

  describe('Progress and completion', () => {
    it('blocks until a file is chosen', () => {
      open();

      expect(buttonLabelled('Remplacer le CV').disabled).toBeTrue();
      choose('cv.pdf');
      expect(buttonLabelled('Remplacer le CV').disabled).toBeFalse();
    });

    it('a programmatic submit with no file still sends nothing', () => {
      open();

      fixture.componentInstance.submit();

      expect(http.match(() => true).length).toBe(0);
    });

    it('reports a real percentage, and renders indeterminate when total is unknown', () => {
      open();
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      const req = http.expectOne(URL);

      req.event({ type: HttpEventType.UploadProgress, loaded: 40, total: 200 });
      fixture.detectChanges();
      expect(fixture.componentInstance.percent()).toBe(20);
      expect(text()).toContain('20 %');

      // A percentage invented from a missing total would be a lie.
      req.event({ type: HttpEventType.UploadProgress, loaded: 80 });
      fixture.detectChanges();
      expect(fixture.componentInstance.percent()).toBeNull();
      expect(fixture.nativeElement.querySelector('mat-progress-bar').getAttribute('mode')).toBe(
        'indeterminate',
      );

      req.flush({ id: 'r1' });
    });

    it('emits `replaced` once, on the response and not on progress', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.replaced.subscribe(() => emitted.push(1));
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      const req = http.expectOne(URL);

      req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      expect(emitted.length).toBe(0);

      req.flush({ id: 'r1' });
      expect(emitted.length).toBe(1);
    });
  });

  describe("The SERVER's refusal is what the reader sees", () => {
    const failsWith = (code: string, message: string, status: number): void => {
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      http.expectOne(URL).flush({ error: { code, message } }, { status, statusText: 'Error' });
      fixture.detectChanges();
    };

    it("D-007's magic-byte refusal is shown verbatim, and nothing is emitted", () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.replaced.subscribe(() => emitted.push(1));

      failsWith(
        'VALIDATION_ERROR',
        "Le contenu du fichier ne correspond pas à un PDF ou un DOCX valide.",
        400,
      );

      expect(text()).toContain('ne correspond pas à un PDF');
      expect(emitted.length).toBe(0);
      // The dialog stays open, with the safety promise still on screen: the
      // existing CV was never touched.
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
      expect(text()).toContain('le CV actuel reste en place');
    });

    it('the progress bar RESETS on failure — a frozen 60% would read as partly uploaded', () => {
      open();
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      const req = http.expectOne(URL);
      req.event({ type: HttpEventType.UploadProgress, loaded: 60, total: 100 });
      fixture.detectChanges();
      expect(fixture.componentInstance.percent()).toBe(60);

      req.flush(
        { error: { code: 'VALIDATION_ERROR', message: 'Fichier trop volumineux.' } },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(fixture.componentInstance.percent()).toBeNull();
      expect(text()).not.toContain('60 %');
    });

    it('a 403 is shown — the GET is open to a Responsable, this POST is not', () => {
      open();
      failsWith('FORBIDDEN', "Votre rôle ne vous autorise pas à accéder à cette ressource.", 403);

      expect(text()).toContain('Votre rôle ne vous autorise pas');
    });

    it('a 503 says storage is unconfigured, not that the file was bad', () => {
      open();
      failsWith('STORAGE_UNAVAILABLE', "Le stockage des CV n'est pas configuré.", 503);

      expect(text()).toContain("n'est pas configuré");
    });

    it('reports an unreachable server rather than appearing to have worked', () => {
      open();
      choose('cv.pdf');
      buttonLabelled('Remplacer le CV').click();
      http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('choosing another file clears the previous verdict', () => {
      open();
      failsWith('VALIDATION_ERROR', 'Contenu invalide.', 400);
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeTruthy();

      choose('autre.pdf');

      expect(fixture.nativeElement.querySelector('.modal__error')).toBeNull();
    });
  });

  it('dismisses without touching the server', () => {
    const dismissed: number[] = [];
    open();
    fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

    buttonLabelled('Annuler').click();

    expect(dismissed.length).toBe(1);
    expect(http.match(() => true).length).toBe(0);
  });
});

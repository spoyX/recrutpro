import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient, HttpEventType } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { CandidateRegister } from './candidate-register';
import { environment } from '../../../../environments/environment';

/**
 * FR-19 to FR-22 — registration and CV upload.
 *
 * The two rules this page exists to get right are D-004's confirm-don't-refuse
 * duplicate and D-007/D-040's server-owned file validation, so most of what is
 * asserted here is about those.
 */
describe('CandidateRegister (FR-19 to FR-22)', () => {
  let fixture: ComponentFixture<CandidateRegister>;
  let http: HttpTestingController;
  let router: Router;

  const CANDIDATES = `${environment.apiUrl}/candidates`;
  const POSITIONS = `${environment.apiUrl}/job-positions`;
  const NEW_ID = '64b7f0c2e1a2b3c4d5e6f7a8';

  const positions = [
    { id: 'p1', title: 'Développeur backend', status: 'Ouvert' },
    { id: 'p2', title: 'Designer produit', status: 'Brouillon' },
    { id: 'p3', title: 'Poste fermé', status: 'Clôturé' },
  ];

  const create = (options = positions): void => {
    fixture = TestBed.createComponent(CandidateRegister);
    fixture.detectChanges();
    http.expectOne(POSITIONS).flush(options);
    fixture.detectChanges();
  };

  /**
   * `textContent`, never `innerText`: the field labels and the phase indicator
   * are `.label-sm`, which uppercases them on screen.
   */
  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  const type = (selector: string, value: string): void => {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const pickPosition = (id: string): void => {
    const el = fixture.nativeElement.querySelector('#reg-position') as HTMLSelectElement;
    el.value = id;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  const fillIdentity = (email = 'jean.martin@example.com'): void => {
    type('#reg-name', 'Jean Martin');
    type('#reg-email', email);
    type('#reg-phone', '0612345678');
    pickPosition('p1');
  };

  const duplicate409 = () => ({
    error: {
      code: 'DUPLICATE_CANDIDATE',
      message:
        "Un candidat avec l'adresse jean.martin@example.com est déjà enregistré sur ce " +
        'poste (Jean Martin, enregistré le 2026-08-01). Renvoyez la demande avec ' +
        '« confirmDuplicate » à true pour créer le doublon volontairement, ou annulez.',
    },
  });

  /** Registers successfully and lands on the CV phase. */
  const reachResumePhase = (): void => {
    create();
    fillIdentity();
    buttonLabelled('Enregistrer le candidat')!.click();
    http
      .expectOne(CANDIDATES)
      .flush({ id: NEW_ID, fullName: 'Jean Martin', currentStage: 'Candidature reçue' });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateRegister],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  describe('The poste picker', () => {
    it('D-001: loads the positions with credentials', () => {
      fixture = TestBed.createComponent(CandidateRegister);
      fixture.detectChanges();

      const req = http.expectOne(POSITIONS);
      expect(req.request.withCredentials).toBeTrue();
      req.flush(positions);
    });

    it('FR-16: excludes CLOSED postings — the server would refuse them anyway', () => {
      create();

      const options = Array.from(
        fixture.nativeElement.querySelectorAll('#reg-position option'),
      ) as HTMLOptionElement[];
      const values = options.filter((o) => o.value).map((o) => o.value);
      expect(values).toEqual(['p1', 'p2']);
      // A draft posting IS offered: only « Clôturé » stops accepting candidates.
      expect(text()).toContain('Designer produit');
      expect(text()).not.toContain('Poste fermé');
    });

    it('says so when no posting can accept a candidate', () => {
      create([{ id: 'p3', title: 'Poste fermé', status: 'Clôturé' }]);

      expect(text()).toContain('Aucun poste ouvert');
    });

    it('preserves the order the server sent — this page does not re-sort', () => {
      create([
        { id: 'b', title: 'Bravo', status: 'Ouvert' },
        { id: 'a', title: 'Alpha', status: 'Ouvert' },
      ]);

      const values = (
        Array.from(fixture.nativeElement.querySelectorAll('#reg-position option')) as HTMLOptionElement[]
      )
        .filter((o) => o.value)
        .map((o) => o.value);
      // Deliberately NOT alphabetical: the server owns the order (and applies
      // D-069's `_id` tiebreaker), so a client-side sort would be a second,
      // competing opinion.
      expect(values).toEqual(['b', 'a']);
    });
  });

  describe('FR-19 — registering', () => {
    it('requires all four fields before it can be submitted', () => {
      create();
      expect(buttonLabelled('Enregistrer le candidat')!.disabled).toBeTrue();

      type('#reg-name', 'Jean Martin');
      expect(buttonLabelled('Enregistrer le candidat')!.disabled).toBeTrue();
      type('#reg-email', 'jean@example.com');
      expect(buttonLabelled('Enregistrer le candidat')!.disabled).toBeTrue();
      type('#reg-phone', '0612345678');
      expect(buttonLabelled('Enregistrer le candidat')!.disabled).toBeTrue();
      pickPosition('p1');
      expect(buttonLabelled('Enregistrer le candidat')!.disabled).toBeFalse();
    });

    it('sends the four fields trimmed, and NO currentStage', () => {
      create();
      type('#reg-name', '  Jean Martin  ');
      type('#reg-email', '  jean.martin@example.com ');
      type('#reg-phone', ' 0612345678 ');
      pickPosition('p1');

      buttonLabelled('Enregistrer le candidat')!.click();

      const req = http.expectOne(CANDIDATES);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({
        fullName: 'Jean Martin',
        email: 'jean.martin@example.com',
        phone: '0612345678',
        jobPositionId: 'p1',
      });
      // FR-19 fixes the initial stage server-side; sending one would be a way
      // into the middle of the pipeline (D-006).
      expect('currentStage' in (req.request.body as object)).toBeFalse();
      // And no confirmDuplicate on a FIRST attempt — not even `false`.
      expect('confirmDuplicate' in (req.request.body as object)).toBeFalse();

      req.flush({ id: NEW_ID, fullName: 'Jean Martin', currentStage: 'Candidature reçue' });
    });

    it('moves to the CV phase and says the candidate already exists', () => {
      reachResumePhase();

      expect(text()).toContain('Jean Martin est enregistré');
      expect(text()).toContain('Le CV est facultatif');
      expect(fixture.nativeElement.querySelector('#reg-resume')).toBeTruthy();
    });
  });

  describe('FR-20 / D-004 — a duplicate is CONFIRMED, never silently handled', () => {
    const provokeDuplicate = (): void => {
      buttonLabelled('Enregistrer le candidat')!.click();
      http.expectOne(CANDIDATES).flush(duplicate409(), { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
    };

    it("shows the server's own message, naming WHO the duplicate is", () => {
      create();
      fillIdentity();
      provokeDuplicate();

      // The detail FR-20 requires — the existing name and the date — comes
      // from the server verbatim rather than being re-worded here.
      expect(text()).toContain('Jean Martin, enregistré le 2026-08-01');
      expect(text()).toContain('jean.martin@example.com');
    });

    it('renders it as a WARNING, not an error, and does not advance', () => {
      create();
      fillIdentity();
      provokeDuplicate();

      expect(fixture.nativeElement.querySelector('.duplicate')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.page__error')).toBeNull();
      // Still on the identity phase — nothing was created.
      expect(fixture.nativeElement.querySelector('#reg-resume')).toBeNull();
    });

    it('does NOT retry automatically — the recruiter has to choose', () => {
      create();
      fillIdentity();
      provokeDuplicate();

      // The single assertion that matters most here: no second request went
      // out on its own.
      http.verify();
      expect(buttonLabelled('Enregistrer quand même')).toBeTruthy();
      expect(buttonLabelled('Annuler')).toBeTruthy();
    });

    it('confirming re-sends with confirmDuplicate: true', () => {
      create();
      fillIdentity();
      provokeDuplicate();

      buttonLabelled('Enregistrer quand même')!.click();

      const retry = http.expectOne(CANDIDATES);
      expect((retry.request.body as Record<string, unknown>)['confirmDuplicate']).toBeTrue();
      retry.flush({ id: NEW_ID, fullName: 'Jean Martin', currentStage: 'Candidature reçue' });
      fixture.detectChanges();

      expect(text()).toContain('Jean Martin est enregistré');
    });

    it('cancelling clears the warning and sends nothing', () => {
      create();
      fillIdentity();
      provokeDuplicate();

      buttonLabelled('Annuler')!.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.duplicate')).toBeNull();
      expect(buttonLabelled('Enregistrer le candidat')).toBeTruthy();
      http.verify();
    });

    it('EDITING THE EMAIL drops the pending confirmation — it was about the old address', () => {
      create();
      fillIdentity();
      provokeDuplicate();
      expect(buttonLabelled('Enregistrer quand même')).toBeTruthy();

      type('#reg-email', 'autre.adresse@example.com');

      // Without this, confirming would create a deliberate duplicate of a
      // record nobody was ever shown — the same hazard as D-074's stale
      // conflict override.
      expect(buttonLabelled('Enregistrer quand même')).toBeUndefined();
      expect(fixture.nativeElement.querySelector('.duplicate')).toBeNull();

      buttonLabelled('Enregistrer le candidat')!.click();
      const req = http.expectOne(CANDIDATES);
      expect('confirmDuplicate' in (req.request.body as object)).toBeFalse();
      req.flush({ id: NEW_ID, fullName: 'Jean Martin', currentStage: 'Candidature reçue' });
    });

    it('changing the POSTE drops it too — the rule is (email, poste)', () => {
      create();
      fillIdentity();
      provokeDuplicate();

      pickPosition('p2');

      expect(buttonLabelled('Enregistrer quand même')).toBeUndefined();
    });
  });

  describe('FR-21 / FR-22 — the CV', () => {
    const attach = (name = 'cv.pdf', type = 'application/pdf'): File => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type });
      const input = fixture.nativeElement.querySelector('#reg-resume') as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      return file;
    };

    it('posts multipart with the field name the server reads', () => {
      reachResumePhase();
      attach();

      buttonLabelled('Envoyer le CV')!.click();

      const req = http.expectOne(`${CANDIDATES}/${NEW_ID}/resume`);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body instanceof FormData).toBeTrue();
      expect((req.request.body as FormData).get('file')).toBeTruthy();
      // The browser must set Content-Type itself — only it knows the multipart
      // boundary, and setting it by hand yields a body the server cannot parse.
      expect(req.request.headers.get('Content-Type')).toBeNull();

      req.flush({
        id: 'r1',
        candidateId: NEW_ID,
        uploadedAt: '2026-08-14T10:00:00.000Z',
        isActive: true,
        downloadUrl: `/api/v1/candidates/${NEW_ID}/resume`,
      });
    });

    it('cannot be sent before a file is chosen', () => {
      reachResumePhase();

      expect(buttonLabelled('Envoyer le CV')!.disabled).toBeTrue();
      attach();
      expect(buttonLabelled('Envoyer le CV')!.disabled).toBeFalse();
    });

    it('reports upload progress', () => {
      reachResumePhase();
      attach();
      buttonLabelled('Envoyer le CV')!.click();

      const req = http.expectOne(`${CANDIDATES}/${NEW_ID}/resume`);
      req.event({ type: HttpEventType.UploadProgress, loaded: 512, total: 1024 });
      fixture.detectChanges();

      expect(fixture.componentInstance.uploadPercent()).toBe(50);
      expect(text()).toContain('50');

      req.flush({
        id: 'r1',
        candidateId: NEW_ID,
        uploadedAt: '2026-08-14T10:00:00.000Z',
        isActive: true,
        downloadUrl: `/api/v1/candidates/${NEW_ID}/resume`,
      });
      fixture.detectChanges();
      expect(text()).toContain('CV joint');
    });

    it('an unknown total leaves the percentage NULL rather than inventing one', () => {
      reachResumePhase();
      attach();
      buttonLabelled('Envoyer le CV')!.click();

      const req = http.expectOne(`${CANDIDATES}/${NEW_ID}/resume`);
      req.event({ type: HttpEventType.UploadProgress, loaded: 512 });
      fixture.detectChanges();

      expect(fixture.componentInstance.uploadPercent()).toBeNull();

      req.flush({
        id: 'r1',
        candidateId: NEW_ID,
        uploadedAt: '2026-08-14T10:00:00.000Z',
        isActive: true,
        downloadUrl: `/api/v1/candidates/${NEW_ID}/resume`,
      });
    });

    it('D-007: a rejected file shows the SERVER\'s reason — no client-side type gate', () => {
      reachResumePhase();
      // A file the browser cheerfully calls a PDF. Only the magic-byte check
      // can tell, and it runs on the server.
      attach('malware.pdf', 'application/pdf');
      buttonLabelled('Envoyer le CV')!.click();

      http.expectOne(`${CANDIDATES}/${NEW_ID}/resume`).flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Le contenu du fichier ne correspond pas à un PDF ou DOCX valide.',
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('ne correspond pas à un PDF ou DOCX valide');
      // The candidate still exists — a failed upload is not a failed
      // registration, and the page must not imply otherwise.
      expect(text()).toContain('Jean Martin');
      expect(fixture.nativeElement.querySelector('#reg-resume')).toBeTruthy();
    });

    it('D-040: no storage URL is used or constructed anywhere', () => {
      reachResumePhase();
      attach();
      buttonLabelled('Envoyer le CV')!.click();
      http.expectOne(`${CANDIDATES}/${NEW_ID}/resume`).flush({
        id: 'r1',
        candidateId: NEW_ID,
        uploadedAt: '2026-08-14T10:00:00.000Z',
        isActive: true,
        downloadUrl: `/api/v1/candidates/${NEW_ID}/resume`,
      });
      fixture.detectChanges();

      const html = fixture.nativeElement.innerHTML as string;
      expect(html).not.toContain('cloudinary');
      expect(html).not.toContain('res.cloudinary.com');
      expect(html).not.toContain('publicId');
    });

    it('FR-21 is optional: the candidate can be finished without a CV', () => {
      reachResumePhase();

      buttonLabelled('Sans CV pour l\'instant')!.click();
      fixture.detectChanges();

      expect(text()).toContain('Candidat enregistré');
      expect(text()).toContain("Aucun CV n'a été joint");
      http.verify();
    });
  });

  describe('After registration', () => {
    it('offers the file, and navigates to it', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      reachResumePhase();
      buttonLabelled('Sans CV pour l\'instant')!.click();
      fixture.detectChanges();

      buttonLabelled('Ouvrir le dossier')!.click();

      expect(navigate).toHaveBeenCalledWith(['/candidates', NEW_ID]);
    });

    it('registering another keeps the POSTE but clears the person', () => {
      reachResumePhase();
      buttonLabelled('Sans CV pour l\'instant')!.click();
      fixture.detectChanges();

      buttonLabelled('Enregistrer un autre candidat')!.click();
      fixture.detectChanges();

      expect((fixture.nativeElement.querySelector('#reg-name') as HTMLInputElement).value).toBe('');
      expect((fixture.nativeElement.querySelector('#reg-email') as HTMLInputElement).value).toBe('');
      // Several candidates against one posting is the common case.
      expect(fixture.componentInstance.jobPositionId()).toBe('p1');
    });
  });

  describe('Errors', () => {
    it('FR-16: a closed position refused by the server is reported', () => {
      create();
      fillIdentity();
      buttonLabelled('Enregistrer le candidat')!.click();

      http.expectOne(CANDIDATES).flush(
        {
          error: {
            code: 'POSITION_CLOSED',
            message: 'Ce poste est clôturé et n’accepte plus de candidature.',
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
      fixture.detectChanges();

      expect(text()).toContain('n’accepte plus de candidature');
      // Not offered as a confirmable duplicate — this one cannot be forced.
      expect(buttonLabelled('Enregistrer quand même')).toBeUndefined();
    });

    it('a 401 goes to the login page', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      create();
      fillIdentity();
      buttonLabelled('Enregistrer le candidat')!.click();

      http.expectOne(CANDIDATES).flush(null, { status: 401, statusText: 'Unauthorized' });

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });

    it('reports an unreachable server', () => {
      create();
      fillIdentity();
      buttonLabelled('Enregistrer le candidat')!.click();

      http.expectOne(CANDIDATES).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it("a 403 on the poste list states the ROLE reason, not a fake outage", () => {
      fixture = TestBed.createComponent(CandidateRegister);
      fixture.detectChanges();
      http.expectOne(POSITIONS).flush(
        {
          error: {
            code: 'FORBIDDEN',
            message: "Votre rôle ne vous autorise pas à accéder à cette ressource.",
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();

      // A Responsable reaching /candidates/new by URL must not be told the
      // server is having trouble.
      expect(text()).toContain('Votre rôle ne vous autorise pas');
      expect(text()).not.toContain('La liste des postes est indisponible');
    });

    it('a failed poste list is reported with a retry, since a poste is required', () => {
      fixture = TestBed.createComponent(CandidateRegister);
      fixture.detectChanges();
      http.expectOne(POSITIONS).flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).toContain('La liste des postes est indisponible');

      buttonLabelled('Réessayer')!.click();
      http.expectOne(POSITIONS).flush(positions);
      fixture.detectChanges();

      expect(text()).toContain('Développeur backend');
    });
  });
});

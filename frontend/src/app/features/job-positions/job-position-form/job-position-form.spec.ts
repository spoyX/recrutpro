import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { JobPositionForm } from './job-position-form';
import { JobPosition } from '../job-position.service';
import { environment } from '../../../../environments/environment';

/**
 * FR-14 (create) and FR-15 (edit).
 *
 * The two rules under test are both the SERVER's, mirrored here only as
 * affordances: « Clôturé » is not an assignable status (D-037), and a
 * department must be active (D-016/D-030). Plus PATCH semantics — only what
 * changed is sent — which is what keeps a position whose department was
 * deactivated afterwards editable in every other field.
 */
describe('JobPositionForm (FR-14, FR-15)', () => {
  let fixture: ComponentFixture<JobPositionForm>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const POSITIONS = `${environment.apiUrl}/job-positions`;
  const DEPARTMENTS = `${environment.apiUrl}/departments`;

  const EXISTING: JobPosition = {
    id: ID,
    title: 'Développeur Angular',
    departmentId: 'd1',
    description: 'Développement de la plateforme.',
    requirements: '3 ans d’expérience.',
    status: 'Ouvert',
    createdAt: '2026-08-01T09:00:00.000Z',
  };

  const DEPTS = [
    { id: 'd1', name: 'Informatique', isActive: true },
    { id: 'd2', name: 'Ressources humaines', isActive: true },
    { id: 'd3', name: 'Ancien service', isActive: false },
  ];

  /** Opens the dialog and answers the department request it makes on init. */
  const open = (position: JobPosition | null = null, departments = DEPTS): void => {
    fixture = TestBed.createComponent(JobPositionForm);
    fixture.componentRef.setInput('position', position);
    fixture.detectChanges();

    const req = http.expectOne((r) => r.url === DEPARTMENTS);
    req.flush(departments);
    fixture.detectChanges();
  };

  /** `textContent`, never `innerText` — the labels are uppercased by CSS. */
  const text = (): string => fixture.nativeElement.textContent as string;

  const field = (id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    fixture.nativeElement.querySelector(`#${id}`);

  const type = (id: string, value: string): void => {
    const el = field(id);
    el.value = value;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
    fixture.detectChanges();
  };

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JobPositionForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('D-037 — « Clôturé » is not a status this form may set', () => {
    it('offers Brouillon and Ouvert, and nothing else', () => {
      open();

      const options = Array.from(
        (field('position-status') as HTMLSelectElement).options,
      ) as HTMLOptionElement[];
      expect(options.map((o) => o.value)).toEqual(['Brouillon', 'Ouvert']);
      // The absence is the point: closing is FR-16's own action, and the
      // update route 400s this value rather than accepting it.
      expect(options.map((o) => o.value)).not.toContain('Clôturé');
    });
  });

  describe('D-016/D-030 — the department must exist and be active', () => {
    it('offers only ACTIVE departments when creating', () => {
      open();

      const values = Array.from((field('position-department') as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      expect(values).toEqual(['', 'd1', 'd2']);
      expect(values).not.toContain('d3');
      expect(text()).not.toContain('Ancien service');
    });

    it("keeps the position's OWN department when editing, even deactivated", () => {
      open({ ...EXISTING, departmentId: 'd3' });

      const values = Array.from((field('position-department') as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      // Named rather than dropped: an empty select on an existing record reads
      // as a rendering fault, and hides which department it actually points at.
      expect(values).toContain('d3');
      expect(text()).toContain('Ancien service');
      expect(text()).toContain('désactivé');
      // …and the reader is told the server would refuse to be sent it back.
      expect(fixture.nativeElement.querySelector('.modal__warning')).toBeTruthy();
    });

    it('shows no such warning once an active department is chosen', () => {
      open({ ...EXISTING, departmentId: 'd3' });
      type('position-department', 'd2');

      expect(fixture.nativeElement.querySelector('.modal__warning')).toBeNull();
    });
  });

  describe('FR-14 — create', () => {
    it('seeds an EMPTY form and posts the trimmed values', () => {
      open();

      expect((field('position-title') as HTMLInputElement).value).toBe('');

      type('position-title', '  Chef de projet  ');
      type('position-department', 'd2');
      type('position-description', '  Pilotage des projets.  ');
      type('position-status', 'Ouvert');

      buttonLabelled('Créer le poste').click();

      const req = http.expectOne((r) => r.method === 'POST' && r.url === POSITIONS);
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({
        title: 'Chef de projet',
        departmentId: 'd2',
        description: 'Pilotage des projets.',
        status: 'Ouvert',
      });
      // Absent, not an empty string: `requirements` is optional and '' is a value.
      expect('requirements' in (req.request.body as object)).toBeFalse();

      req.flush({ ...EXISTING, title: 'Chef de projet' });
    });

    it('blocks until the three required fields are filled', () => {
      open();

      expect(buttonLabelled('Créer le poste').disabled).toBeTrue();
      type('position-title', 'Chef de projet');
      expect(buttonLabelled('Créer le poste').disabled).toBeTrue();
      type('position-department', 'd2');
      expect(buttonLabelled('Créer le poste').disabled).toBeTrue();
      type('position-description', 'Pilotage.');
      expect(buttonLabelled('Créer le poste').disabled).toBeFalse();
    });

    it('blocks on a WHITESPACE-ONLY title', () => {
      open();
      type('position-title', '    ');
      type('position-department', 'd2');
      type('position-description', 'Pilotage.');

      expect(buttonLabelled('Créer le poste').disabled).toBeTrue();
    });

    it('a programmatic submit past the disabled button still sends nothing', () => {
      open();

      fixture.componentInstance.submit();

      // An explicit count, not a bare verify() Jasmine cannot see.
      expect(http.match((r) => r.method !== 'GET').length).toBe(0);
    });
  });

  describe('FR-15 — edit', () => {
    it('D-074: seeds from the input, which the CONSTRUCTOR could not have read', () => {
      open(EXISTING);

      // If seeding had happened in the constructor, `position()` would still
      // have held its `null` default and every one of these would be empty —
      // a create form silently pointed at an existing record.
      expect((field('position-title') as HTMLInputElement).value).toBe('Développeur Angular');
      expect((field('position-department') as HTMLSelectElement).value).toBe('d1');
      expect((field('position-description') as HTMLTextAreaElement).value).toBe(
        'Développement de la plateforme.',
      );
      expect((field('position-requirements') as HTMLTextAreaElement).value).toBe(
        '3 ans d’expérience.',
      );
      expect((field('position-status') as HTMLSelectElement).value).toBe('Ouvert');
      expect(text()).toContain('Modifier le poste');
    });

    it('PATCHes ONLY what changed', () => {
      open(EXISTING);
      type('position-title', 'Développeur Angular senior');

      buttonLabelled('Enregistrer les modifications').click();

      const req = http.expectOne((r) => r.method === 'PATCH');
      expect(req.request.url).toBe(`${POSITIONS}/${ID}`);
      expect(req.request.body).toEqual({ title: 'Développeur Angular senior' });
      // The untouched department is NOT resent — which is what keeps a position
      // pointing at a since-deactivated one editable at all (D-030).
      expect('departmentId' in (req.request.body as object)).toBeFalse();

      req.flush({ ...EXISTING, title: 'Développeur Angular senior' });
    });

    it('an untouched deactivated department is never revalidated', () => {
      open({ ...EXISTING, departmentId: 'd3' });
      type('position-description', 'Description révisée.');

      buttonLabelled('Enregistrer les modifications').click();

      const req = http.expectOne((r) => r.method === 'PATCH');
      expect(req.request.body).toEqual({ description: 'Description révisée.' });
      req.flush({ ...EXISTING, departmentId: 'd3' });
    });

    it('clearing the optional requirements sends an empty string, not nothing', () => {
      open(EXISTING);
      type('position-requirements', '');

      buttonLabelled('Enregistrer les modifications').click();

      const req = http.expectOne((r) => r.method === 'PATCH');
      // Omitting it would leave the old text in place — « effacer » and « ne pas
      // toucher » are different intentions and must not collapse into one.
      expect(req.request.body).toEqual({ requirements: '' });
      req.flush({ ...EXISTING, requirements: null });
    });

    it('emits the saved position', () => {
      const emitted: JobPosition[] = [];
      open(EXISTING);
      fixture.componentInstance.saved.subscribe((p) => emitted.push(p));

      type('position-title', 'Nouveau titre');
      buttonLabelled('Enregistrer les modifications').click();
      http.expectOne((r) => r.method === 'PATCH').flush({ ...EXISTING, title: 'Nouveau titre' });

      expect(emitted.length).toBe(1);
      expect(emitted[0].title).toBe('Nouveau titre');
    });
  });

  describe('The SERVER half still reaches the reader', () => {
    const failsWith = (message: string, status: number): void => {
      type('position-title', 'Chef de projet');
      type('position-department', 'd2');
      type('position-description', 'Pilotage.');
      buttonLabelled('Créer le poste').click();
      http
        .expectOne((r) => r.method === 'POST')
        .flush({ error: { code: 'VALIDATION_ERROR', message } }, { status, statusText: 'Error' });
      fixture.detectChanges();
    };

    it("D-030's refusal is shown verbatim and nothing is emitted", () => {
      const emitted: JobPosition[] = [];
      open();
      fixture.componentInstance.saved.subscribe((p) => emitted.push(p));

      failsWith(
        "Ce département n'existe pas ou a été désactivé. Choisissez un département actif.",
        400,
      );

      expect(text()).toContain('a été désactivé');
      expect(emitted.length).toBe(0);
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    });

    it('D-038: a 403 on the write is shown, not swallowed', () => {
      open();
      failsWith("Votre rôle ne vous autorise pas à accéder à cette ressource.", 403);

      expect(text()).toContain('Votre rôle ne vous autorise pas');
    });

    it('D-037: the closed-position lock is reported, not retried', () => {
      open(EXISTING);
      type('position-title', 'Autre titre');
      buttonLabelled('Enregistrer les modifications').click();
      http.expectOne((r) => r.method === 'PATCH').flush(
        {
          error: {
            code: 'POSITION_CLOSED',
            message:
              'Ce poste est clôturé et ne peut plus être modifié. Rouvrez un nouveau poste si nécessaire.',
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
      fixture.detectChanges();

      expect(text()).toContain('ne peut plus être modifié');
    });

    it('reports an unreachable server rather than appearing to have worked', () => {
      open();
      type('position-title', 'Chef de projet');
      type('position-department', 'd2');
      type('position-description', 'Pilotage.');
      buttonLabelled('Créer le poste').click();
      http
        .expectOne((r) => r.method === 'POST')
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('losing the department list is reported — a poste needs one', () => {
      fixture = TestBed.createComponent(JobPositionForm);
      fixture.detectChanges();
      http
        .expectOne((r) => r.url === DEPARTMENTS)
        .flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).toContain('départements');
      expect(buttonLabelled('Créer le poste').disabled).toBeTrue();
    });
  });

  it('dismisses without touching the server', () => {
    const dismissed: number[] = [];
    open();
    fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

    buttonLabelled('Annuler').click();

    expect(dismissed.length).toBe(1);
    expect(http.match((r) => r.method !== 'GET').length).toBe(0);
  });
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserForm } from './user-form';
import { AdminUser, Department } from '../admin.service';
import { environment } from '../../../../environments/environment';

/**
 * FR-6 (create) and FR-7 (edit).
 *
 * The assertions that matter are the two asymmetries: the password field exists
 * only on create because PATCH accepts no password, and the department field
 * exists only for the two roles that have one because the server clears it on
 * an Administrateur.
 */
describe('UserForm (FR-6, FR-7)', () => {
  let fixture: ComponentFixture<UserForm>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const USERS = `${environment.apiUrl}/users`;

  const DEPTS: Department[] = [
    { id: 'd1', name: 'Informatique', isActive: true },
    { id: 'd2', name: 'Ressources humaines', isActive: true },
    { id: 'd3', name: 'Ancien service', isActive: false },
  ];

  const EXISTING: AdminUser = {
    id: ID,
    name: 'Marie Dupont',
    email: 'marie@example.com',
    role: 'Recruteur',
    departmentId: 'd1',
    isActive: true,
    mustChangePassword: false,
  };

  const open = (user: AdminUser | null = null, departments = DEPTS): void => {
    fixture = TestBed.createComponent(UserForm);
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('departments', departments);
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const field = (id: string): HTMLInputElement | HTMLSelectElement | null =>
    fixture.nativeElement.querySelector(`#${id}`);

  const type = (id: string, value: string): void => {
    const el = field(id)!;
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
      imports: [UserForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('issues NO request when it opens — the departments are passed in', () => {
    open();
    expect(http.match(() => true).length).toBe(0);
  });

  describe('The password field is CREATE-only', () => {
    it('is present when creating', () => {
      open();
      expect(field('user-password')).toBeTruthy();
      expect(field('user-email')).toBeTruthy();
    });

    it('is ABSENT when editing, because PATCH accepts no password', () => {
      open(EXISTING);

      // A box here would promise a change no route performs.
      expect(field('user-password')).toBeNull();
      expect(field('user-email')).toBeNull();
      // Stated instead, with the action that DOES change it.
      expect(text()).toContain('marie@example.com');
      expect(text()).toContain('Réinitialiser le mot de passe');
    });

    it('enforces the 8-character minimum the server enforces', () => {
      open();
      type('user-name', 'Jean Martin');
      type('user-email', 'jean@example.com');
      type('user-password', 'court');
      type('user-department', 'd1');

      expect(buttonLabelled('Créer le compte').disabled).toBeTrue();
      expect(text()).toContain('au moins 8 caractères');

      type('user-password', 'S3cret!Passw0rd');
      expect(buttonLabelled('Créer le compte').disabled).toBeFalse();
    });
  });

  describe('D-016/D-030 — the role decides whether a department is required', () => {
    it('requires one for a Recruteur', () => {
      open();
      type('user-name', 'Jean');
      type('user-email', 'jean@example.com');
      type('user-password', 'S3cret!Passw0rd');

      expect(field('user-department')).toBeTruthy();
      expect(buttonLabelled('Créer le compte').disabled).toBeTrue();

      type('user-department', 'd1');
      expect(buttonLabelled('Créer le compte').disabled).toBeFalse();
    });

    it('hides it for an Administrateur, who has none by design', () => {
      open();
      type('user-name', 'Jean');
      type('user-email', 'jean@example.com');
      type('user-password', 'S3cret!Passw0rd');
      type('user-role', 'Administrateur');

      expect(field('user-department')).toBeNull();
      expect(text()).toContain("n'est rattaché à aucun département");
      expect(buttonLabelled('Créer le compte').disabled).toBeFalse();
    });

    it('DISCARDS a chosen department when the role becomes Administrateur', () => {
      open();
      type('user-name', 'Jean');
      type('user-email', 'jean@example.com');
      type('user-password', 'S3cret!Passw0rd');
      type('user-department', 'd1');

      type('user-role', 'Administrateur');
      expect(fixture.componentInstance.departmentId()).toBe('');

      buttonLabelled('Créer le compte').click();
      const req = http.expectOne(USERS);
      // The server clears it anyway; sending it would leave the form
      // disagreeing with the stored record.
      expect('departmentId' in (req.request.body as object)).toBeFalse();
      req.flush({ ...EXISTING, role: 'Administrateur', departmentId: null });
    });

    it('offers only ACTIVE departments when creating', () => {
      open();

      const values = Array.from((field('user-department') as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      expect(values).toEqual(['', 'd1', 'd2']);
      expect(text()).not.toContain('Ancien service');
    });

    it("keeps the account's OWN department when editing, even deactivated", () => {
      open({ ...EXISTING, departmentId: 'd3' });

      const values = Array.from((field('user-department') as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      expect(values).toContain('d3');
      expect(text()).toContain('Ancien service');
      expect(fixture.nativeElement.querySelector('.modal__warning')).toBeTruthy();
    });
  });

  describe('FR-6 — create', () => {
    it('POSTs the trimmed values with the session cookie', () => {
      open();
      type('user-name', '  Jean Martin  ');
      type('user-email', '  jean@example.com  ');
      type('user-password', 'S3cret!Passw0rd');
      type('user-role', 'ResponsableHierarchique');
      type('user-department', 'd2');

      buttonLabelled('Créer le compte').click();

      const req = http.expectOne(USERS);
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(req.request.body).toEqual({
        name: 'Jean Martin',
        email: 'jean@example.com',
        password: 'S3cret!Passw0rd',
        role: 'ResponsableHierarchique',
        departmentId: 'd2',
      });

      req.flush(EXISTING);
    });

    it('a programmatic submit past the disabled button still sends nothing', () => {
      open();
      fixture.componentInstance.submit();
      expect(http.match(() => true).length).toBe(0);
    });
  });

  describe('FR-7 — edit', () => {
    it('D-074: seeds from the input, which the CONSTRUCTOR could not have read', () => {
      open(EXISTING);

      expect((field('user-name') as HTMLInputElement).value).toBe('Marie Dupont');
      expect((field('user-role') as HTMLSelectElement).value).toBe('Recruteur');
      expect((field('user-department') as HTMLSelectElement).value).toBe('d1');
    });

    it('PATCHes only what changed', () => {
      open(EXISTING);
      type('user-name', 'Marie Durand');

      buttonLabelled('Enregistrer').click();

      const req = http.expectOne(`${USERS}/${ID}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Marie Durand' });
      req.flush({ ...EXISTING, name: 'Marie Durand' });
    });

    it('sends the department when the ROLE changes to one that needs it', () => {
      open({ ...EXISTING, role: 'Administrateur', departmentId: null });
      type('user-role', 'Recruteur');
      type('user-department', 'd2');

      buttonLabelled('Enregistrer').click();

      const req = http.expectOne(`${USERS}/${ID}`);
      expect(req.request.body).toEqual({ role: 'Recruteur', departmentId: 'd2' });
      req.flush({ ...EXISTING, departmentId: 'd2' });
    });

    it('emits the saved account', () => {
      const emitted: AdminUser[] = [];
      open(EXISTING);
      fixture.componentInstance.saved.subscribe((u) => emitted.push(u));

      type('user-name', 'Marie Durand');
      buttonLabelled('Enregistrer').click();
      http.expectOne(`${USERS}/${ID}`).flush({ ...EXISTING, name: 'Marie Durand' });

      expect(emitted.length).toBe(1);
      expect(emitted[0].name).toBe('Marie Durand');
    });
  });

  describe("The SERVER's refusal reaches the reader", () => {
    it('a duplicate email is shown verbatim and nothing is emitted', () => {
      const emitted: AdminUser[] = [];
      open();
      fixture.componentInstance.saved.subscribe((u) => emitted.push(u));

      type('user-name', 'Jean');
      type('user-email', 'marie@example.com');
      type('user-password', 'S3cret!Passw0rd');
      type('user-department', 'd1');
      buttonLabelled('Créer le compte').click();
      http.expectOne(USERS).flush(
        {
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Un compte existe déjà avec cette adresse email. Utilisez une autre adresse.',
          },
        },
        { status: 409, statusText: 'Conflict' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Un compte existe déjà avec cette adresse email');
      expect(emitted.length).toBe(0);
      expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
    });

    it("D-030's inactive-department refusal is surfaced", () => {
      open();
      type('user-name', 'Jean');
      type('user-email', 'jean@example.com');
      type('user-password', 'S3cret!Passw0rd');
      type('user-department', 'd1');
      buttonLabelled('Créer le compte').click();
      http.expectOne(USERS).flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: "Ce département n'existe pas ou a été désactivé. Choisissez un département actif.",
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('a été désactivé');
    });

    it('reports an unreachable server', () => {
      open();
      type('user-name', 'Jean');
      type('user-email', 'jean@example.com');
      type('user-password', 'S3cret!Passw0rd');
      type('user-department', 'd1');
      buttonLabelled('Créer le compte').click();
      http.expectOne(USERS).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
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

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AdminUsers } from './admin-users';
import { AdminUser, Department } from '../admin.service';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';
import { drainShellRequests, expectNoPageRequests } from '../../../testing/shell-requests';

/** FR-6 to FR-13 — the administration screen. */
describe('AdminUsers (FR-6 to FR-13)', () => {
  let fixture: ComponentFixture<AdminUsers>;
  let http: HttpTestingController;
  let router: Router;

  const USERS = `${environment.apiUrl}/users`;
  const DEPARTMENTS = `${environment.apiUrl}/departments`;
  const ME = 'admin-1';

  const user = (over: Partial<AdminUser> = {}): AdminUser => ({
    id: 'u1',
    name: 'Marie Dupont',
    email: 'marie@example.com',
    role: 'Recruteur',
    departmentId: 'd1',
    isActive: true,
    mustChangePassword: false,
    ...over,
  });

  const DEPTS: Department[] = [
    { id: 'd1', name: 'Informatique', isActive: true },
    { id: 'd2', name: 'Ancien service', isActive: false },
  ];

  const signIn = (): void => {
    TestBed.inject(AuthService).currentUser.set({
      id: ME,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'Administrateur',
      departmentId: null,
      mustChangePassword: false,
    });
  };

  const usersRequest = (): TestRequest => http.expectOne((r) => r.url === USERS);
  const departmentsRequest = (): TestRequest => http.expectOne((r) => r.url === DEPARTMENTS);

  const load = (rows: AdminUser[] = [user()], departments = DEPTS): void => {
    fixture = TestBed.createComponent(AdminUsers);
    fixture.detectChanges();
    usersRequest().flush(rows);
    departmentsRequest().flush(departments);
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const rowFor = (name: string): HTMLElement =>
    (Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[]).find((r) =>
      r.textContent?.includes(name),
    )!;

  /**
   * The confirmation inside the DIALOG. Scoped to `.modal`, because the row
   * button that opens it and this one both live on the page — an unscoped
   * `find` by label takes whichever comes first in DOM order (D-082).
   */
  const confirmButton = (): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('.modal button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Confirmer'),
    ) as HTMLButtonElement;

  const rowButton = (name: string, label: string): HTMLButtonElement | undefined =>
    Array.from(rowFor(name).querySelectorAll('button')).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminUsers],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    signIn();
  });

  afterEach(() => {
    drainShellRequests(http);
    http.verify();
  });

  describe('FR-12 — the directory', () => {
    it('asks for both lists, with the session cookie and no stray filters', () => {
      fixture = TestBed.createComponent(AdminUsers);
      fixture.detectChanges();

      const users = usersRequest();
      expect(users.request.method).toBe('GET');
      expect(users.request.withCredentials).toBeTrue();
      // An empty `role=` is an unknown filter value the server 400s.
      expect(users.request.params.keys()).toEqual([]);

      const departments = departmentsRequest();
      // This screen MANAGES departments, so unlike every picker it must see
      // the deactivated ones too.
      expect(departments.request.params.get('includeInactive')).toBe('true');

      users.flush([user()]);
      departments.flush(DEPTS);
    });

    it('D-084: renders the account STATE, which the response now carries', () => {
      load([user({ name: 'Actif' }), user({ id: 'u2', name: 'Inactif', isActive: false })]);

      expect(rowFor('Actif').textContent).toContain('Actif');
      expect(rowFor('Inactif').textContent).toContain('Désactivé');
      expect(rowFor('Inactif').classList).toContain('row--inactive');
    });

    it('FR-10: flags an account sitting on a temporary credential', () => {
      load([user({ mustChangePassword: true })]);

      expect(text()).toContain('Mot de passe à changer');
    });

    it('resolves the department NAME, and says « — » for a global account', () => {
      load([user(), user({ id: 'u2', name: 'Admin Deux', role: 'Administrateur', departmentId: null })]);

      expect(rowFor('Marie Dupont').textContent).toContain('Informatique');
      // An Administrateur has none by design (D-016) — a rule, not a gap.
      expect(rowFor('Admin Deux').textContent).toContain('—');
    });

    it('sends each filter and clears them together', () => {
      load();

      fixture.componentInstance.setFilter('role', 'Recruteur');
      const byRole = usersRequest();
      expect(byRole.request.params.get('role')).toBe('Recruteur');
      byRole.flush([user()]);

      fixture.componentInstance.setFilter('isActive', 'false');
      const both = usersRequest();
      expect(both.request.params.get('role')).toBe('Recruteur');
      expect(both.request.params.get('isActive')).toBe('false');
      both.flush([]);
      fixture.detectChanges();

      fixture.componentInstance.resetFilters();
      const cleared = usersRequest();
      expect(cleared.request.params.keys()).toEqual([]);
      cleared.flush([user()]);
    });
  });

  describe('FR-8 / FR-9 — and D-029', () => {
    it('offers DEACTIVATE on an active account and REACTIVATE on a deactivated one', () => {
      load([user({ name: 'Actif' }), user({ id: 'u2', name: 'Inactif', isActive: false })]);

      expect(rowButton('Actif', 'Désactiver')).toBeTruthy();
      expect(rowButton('Actif', 'Réactiver')).toBeUndefined();
      expect(rowButton('Inactif', 'Réactiver')).toBeTruthy();
      expect(rowButton('Inactif', 'Désactiver')).toBeUndefined();
    });

    it('D-029: offers NEITHER on the administrator’s OWN account', () => {
      load([user({ id: ME, name: 'Admin Moi' })]);

      // The server 400s self-deactivation because nobody else could undo it.
      expect(rowButton('Admin Moi', 'Désactiver')).toBeUndefined();
      expect(rowFor('Admin Moi').textContent).toContain('Votre compte');
      // Editing themselves is still fine.
      expect(rowButton('Admin Moi', 'Modifier')).toBeTruthy();
    });

    it('asks before deactivating, and names the immediate consequence', () => {
      load([user()]);

      rowButton('Marie Dupont', 'Désactiver')!.click();
      fixture.detectChanges();

      // D-027 reloads the user per request, so a live session dies at once.
      expect(text()).toContain('cessera de fonctionner immédiatement');
      // Nothing sent until the confirmation.
      expectNoPageRequests(http);

      confirmButton().click();

      const req = http.expectOne(`${USERS}/u1/deactivate`);
      expect(req.request.method).toBe('PATCH');
      req.flush(user({ isActive: false }));
      fixture.detectChanges();

      // The SERVER's row replaces ours, and the list is not refetched.
      expect(rowFor('Marie Dupont').textContent).toContain('Désactivé');
      expectNoPageRequests(http);
    });

    it('reactivates without asking — FR-8 can undo it', () => {
      load([user({ isActive: false })]);

      rowButton('Marie Dupont', 'Réactiver')!.click();

      const req = http.expectOne(`${USERS}/u1/reactivate`);
      req.flush(user({ isActive: true }));
      fixture.detectChanges();

      expect(rowFor('Marie Dupont').textContent).toContain('Actif');
    });

    it('a failed action shows the message and leaves the row UNCHANGED', () => {
      load([user()]);

      rowButton('Marie Dupont', 'Désactiver')!.click();
      fixture.detectChanges();
      confirmButton().click();

      http.expectOne(`${USERS}/u1/deactivate`).flush(
        {
          error: {
            code: 'CANNOT_DEACTIVATE_SELF',
            message: 'Vous ne pouvez pas désactiver votre propre compte.',
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Vous ne pouvez pas désactiver votre propre compte.');
      // Still active — before and after, not just after.
      expect(rowFor('Marie Dupont').textContent).toContain('Actif');
      expect(fixture.componentInstance.users()[0].isActive).toBeTrue();
    });
  });

  describe('FR-13 — departments', () => {
    it('lists deactivated ones too, and says what that means', () => {
      load();

      expect(text()).toContain('Informatique');
      expect(text()).toContain('Ancien service');
      // Their continued presence here must not read as a bug.
      expect(text()).toContain("n'est plus proposé lors de la création");
    });

    it('toggles a department and takes the SERVER’s answer', () => {
      load();

      const row = (Array.from(fixture.nativeElement.querySelectorAll('.rows__row')) as HTMLElement[])
        .find((r) => r.textContent?.includes('Informatique'))!;
      (Array.from(row.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Désactiver'),
      ) as HTMLButtonElement).click();

      const req = http.expectOne(`${DEPARTMENTS}/d1/deactivate`);
      expect(req.request.method).toBe('PATCH');
      req.flush({ id: 'd1', name: 'Informatique', isActive: false });
      fixture.detectChanges();

      expect(fixture.componentInstance.departments()[0].isActive).toBeFalse();
    });

    it('a rename re-reads BOTH lists — every user row shows the name', () => {
      load();

      fixture.componentInstance.onDepartmentSaved();

      departmentsRequest().flush([{ id: 'd1', name: 'Ingénierie', isActive: true }]);
      usersRequest().flush([user()]);
      fixture.detectChanges();

      expect(rowFor('Marie Dupont').textContent).toContain('Ingénierie');
    });
  });

  describe('Errors', () => {
    it('a failed DEPARTMENT list does not blank the accounts', () => {
      fixture = TestBed.createComponent(AdminUsers);
      fixture.detectChanges();
      usersRequest().flush([user()]);
      departmentsRequest().flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).toContain('Marie Dupont');
      expect(text()).toContain('La liste des départements est momentanément indisponible.');
    });

    it("a 403 shows the server's own message", () => {
      fixture = TestBed.createComponent(AdminUsers);
      fixture.detectChanges();
      usersRequest().flush(
        {
          error: {
            code: 'FORBIDDEN',
            message: "L'annuaire des comptes est réservé à l'administration.",
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );
      departmentsRequest().flush(DEPTS);
      fixture.detectChanges();

      expect(text()).toContain("réservé à l'administration");
      expect(text()).not.toContain('momentanément indisponible');
    });

    it('FR-2 / FR-8: a 401 navigates to /login', () => {
      const navigate = spyOn(router, 'navigate').and.resolveTo(true);
      fixture = TestBed.createComponent(AdminUsers);
      fixture.detectChanges();
      usersRequest().flush(null, { status: 401, statusText: 'Unauthorized' });
      departmentsRequest().flush(DEPTS);

      expect(navigate).toHaveBeenCalledWith(['/login']);
    });
  });
});

import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError, AuthService } from '../../../core/auth.service';
import { AdminService, AdminUser, Department, UserFilters, ROLES } from '../admin.service';
import { UserForm } from '../user-form/user-form';
import { ResetPassword } from '../reset-password/reset-password';
import { DepartmentForm } from '../department-form/department-form';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-6 to FR-13 — the administration screen: accounts and departments.
 *
 * NO NEW ROUTE — the fourteenth run of the endpoint check. Every operation
 * already existed. **One backend change was needed and it was NOT a new
 * route or field**: `PublicUser` omitted `isActive`, so an account list could
 * not say which state a row was in. Added as a separate `AdminUser` shape
 * (D-084) rather than widening `PublicUser`, because three auth tests pin that
 * response's exact field set — including, in as many words, that it carries no
 * `isActive`.
 *
 * BOTH modules on ONE screen, deliberately. A user cannot be created without a
 * department (D-030) and there was no UI to create one, so splitting them
 * would ship a page whose main action is blocked by a page that does not exist.
 *
 * D-029 — an administrator cannot deactivate THEMSELVES, and the server says so
 * with a 400. Mirrored here as a missing button rather than a click into an
 * error, because the reason is structural: nobody else could undo it.
 */
@Component({
  selector: 'app-admin-users',
  imports: [ModalFocus, 
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    UserAvatar,
    UserForm,
    ResetPassword,
    DepartmentForm,
  ],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
})
export class AdminUsers {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly roles = ROLES;

  /** 5.2 — the three states of FR-12's `isActive` filter, as a segmented control. */
  protected readonly statusOptions = [
    { value: '', label: 'Tous' },
    { value: 'true', label: 'Actifs' },
    { value: 'false', label: 'Désactivés' },
  ] as const;

  // ------------------------------------------------------ FR-6 to FR-12

  readonly users = signal<AdminUser[]>([]);
  readonly usersLoading = signal(true);
  readonly usersError = signal<string | null>(null);
  readonly filters = signal<UserFilters>({});

  readonly isFiltered = computed(() => Object.values(this.filters()).some((v) => !!v));

  readonly creating = signal(false);
  readonly editing = signal<AdminUser | null>(null);
  readonly resetting = signal<AdminUser | null>(null);
  /** The row awaiting a deactivate confirmation, held inline (FR-34's shape). */
  readonly deactivating = signal<AdminUser | null>(null);
  readonly rowBusy = signal<string | null>(null);
  readonly rowError = signal<string | null>(null);

  // ---------------------------------------------------------------- FR-13

  readonly departments = signal<Department[]>([]);
  readonly departmentsError = signal<string | null>(null);
  readonly departmentForm = signal<Department | null | undefined>(undefined);

  /** Undefined = closed; null = create; a department = rename. */
  readonly departmentFormOpen = computed(() => this.departmentForm() !== undefined);

  constructor() {
    this.loadUsers();
    this.loadDepartments();
  }

  /** D-029: the server refuses self-deactivation, so the row does not offer it. */
  isSelf(user: AdminUser): boolean {
    return this.auth.currentUser()?.id === user.id;
  }

  formatRole(role: string): string {
    if (role === 'ResponsableHierarchique') return 'RESPONSABLE';
    if (role === 'Administrateur') return 'ADMINISTRATEUR';
    if (role === 'Recruteur') return 'RECRUTEUR';
    return role;
  }

  departmentName(id: string | null): string {
    if (!id) {
      return '—';
    }
    return this.departments().find((d) => d.id === id)?.name ?? 'Département inconnu';
  }

  loadUsers(): void {
    this.usersLoading.set(true);
    this.usersError.set(null);

    this.admin.listUsers(this.filters()).subscribe({
      next: (users) => {
        this.users.set(users);
        this.usersLoading.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.usersLoading.set(false);
        this.users.set([]);
        this.usersError.set(this.messageFor(response, "L'annuaire des comptes"));
      },
    });
  }

  loadDepartments(): void {
    this.departmentsError.set(null);
    // includeInactive: this screen MANAGES them, so it must show the ones the
    // pickers elsewhere deliberately hide.
    this.admin.listDepartments(true).subscribe({
      next: (departments) => this.departments.set(departments),
      error: (response: HttpErrorResponse) => {
        this.departments.set([]);
        this.departmentsError.set(this.messageFor(response, 'La liste des départements'));
      },
    });
  }

  setFilter(key: keyof UserFilters, value: string): void {
    this.filters.update((current) => ({ ...current, [key]: value || undefined }));
    this.loadUsers();
  }

  resetFilters(): void {
    this.filters.set({});
    this.loadUsers();
  }

  /** FR-6/FR-7 change the row, and an edit may move a department. Re-read. */
  onUserSaved(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.loadUsers();
  }

  /** FR-10 flips `mustChangePassword`, which the list shows. Re-read. */
  onResetFinished(): void {
    this.resetting.set(null);
    this.loadUsers();
  }

  // ------------------------------------------------------- FR-8 and FR-9

  confirmDeactivate(): void {
    const user = this.deactivating();
    if (!user) {
      return;
    }
    this.runRowAction(user, this.admin.deactivateUser(user.id), () =>
      this.deactivating.set(null),
    );
  }

  reactivate(user: AdminUser): void {
    // FR-9 restores access and is undoable by FR-8, so it asks nothing first.
    this.runRowAction(user, this.admin.reactivateUser(user.id));
  }

  private runRowAction(
    user: AdminUser,
    request: ReturnType<AdminService['deactivateUser']>,
    onSuccess?: () => void,
  ): void {
    this.rowBusy.set(user.id);
    this.rowError.set(null);

    request.subscribe({
      next: (updated) => {
        this.rowBusy.set(null);
        onSuccess?.();
        // The SERVER's row replaces ours — `isActive` is its answer, not our
        // assumption about what the call did.
        this.users.update((current) => current.map((u) => (u.id === updated.id ? updated : u)));
      },
      error: (response: HttpErrorResponse) => {
        this.rowBusy.set(null);
        this.rowError.set(this.messageFor(response, 'Cette action'));
      },
    });
  }

  // ---------------------------------------------------------------- FR-13

  openDepartmentForm(department: Department | null): void {
    this.departmentForm.set(department);
  }

  closeDepartmentForm(): void {
    this.departmentForm.set(undefined);
  }

  onDepartmentSaved(): void {
    this.closeDepartmentForm();
    // A rename changes what every user row shows, so both lists are re-read.
    this.loadDepartments();
    this.loadUsers();
  }

  toggleDepartment(department: Department): void {
    this.rowBusy.set(department.id);
    this.departmentsError.set(null);

    const request = department.isActive
      ? this.admin.deactivateDepartment(department.id)
      : this.admin.reactivateDepartment(department.id);

    request.subscribe({
      next: (updated) => {
        this.rowBusy.set(null);
        this.departments.update((current) =>
          current.map((d) => (d.id === updated.id ? updated : d)),
        );
      },
      error: (response: HttpErrorResponse) => {
        this.rowBusy.set(null);
        this.departmentsError.set(this.messageFor(response, 'Cette action'));
      },
    });
  }

  private messageFor(response: HttpErrorResponse, subject: string): string {
    // FR-2 expiry or FR-8 deactivation — including this administrator being
    // deactivated by another one mid-session (D-027 reloads every request).
    if (response.status === 401) {
      void this.router.navigate(['/login']);
      return '';
    }

    const body = response.error as ApiError | null;
    return (
      body?.error?.message ??
      (response.status === 0
        ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
        : `${subject} est momentanément indisponible. Réessayez.`)
    );
  }
}

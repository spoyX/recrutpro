import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import {
  AdminService,
  AdminUser,
  Department,
  Role,
  ROLES,
  ROLES_NEEDING_DEPARTMENT,
} from '../admin.service';

/**
 * FR-6 (create) and FR-7 (edit) — ONE dialog, because they are one form minus
 * one field.
 *
 * *** THE PASSWORD FIELD EXISTS ONLY ON CREATE, AND THAT IS A SERVER FACT. ***
 * `POST /users` requires a password; `PATCH /users/:id` accepts only name, role
 * and department. Changing someone's password is FR-10's own action, which
 * issues a temporary credential rather than letting an administrator choose one
 * — so an edit form offering a password box would be promising something no
 * route performs.
 *
 * *** THE ROLE DECIDES WHETHER A DEPARTMENT IS REQUIRED, AND BOTH DIRECTIONS
 * MATTER. *** D-016/D-030: a Recruteur or Responsable must have an active one;
 * an Administrateur is global and the server CLEARS any department left on one.
 * The form mirrors that by hiding the picker for an Administrateur and
 * discarding the value, rather than sending a field the server will drop —
 * the same reasoning as the CV-review dialog discarding a motive on a pass.
 */
@Component({
  selector: 'app-user-form',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './user-form.html',
  styleUrl: './user-form.scss',
})
export class UserForm implements OnInit {
  private readonly admin = inject(AdminService);

  /** Null = FR-6 create. Non-null = FR-7 edit of that account. */
  readonly user = input<AdminUser | null>(null);
  /** Passed in: the page already holds them, and FR-13 manages them there. */
  readonly departments = input.required<Department[]>();

  readonly saved = output<AdminUser>();
  readonly dismissed = output<void>();

  protected readonly roles = ROLES;

  readonly name = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly role = signal<Role>('Recruteur');
  readonly departmentId = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly isEdit = computed(() => this.user() !== null);

  /** D-016/D-030 — only these two roles carry one. */
  readonly needsDepartment = computed(() => ROLES_NEEDING_DEPARTMENT.includes(this.role()));

  /**
   * Only ACTIVE departments may be assigned (D-030) — plus the one this account
   * already points at, even if it has since been deactivated, so an existing
   * value is named rather than rendering as an empty select.
   */
  readonly departmentChoices = computed(() => {
    const current = this.user()?.departmentId ?? null;
    return this.departments().filter((d) => d.isActive || d.id === current);
  });

  readonly departmentInactive = computed(() => {
    const match = this.departments().find((d) => d.id === this.departmentId());
    return match !== undefined && !match.isActive;
  });

  readonly canSubmit = computed(() => {
    if (this.busy() || this.name().trim() === '') {
      return false;
    }
    if (this.needsDepartment() && this.departmentId() === '') {
      return false;
    }
    // Email and password are create-only: PATCH accepts neither.
    if (!this.isEdit()) {
      return this.email().trim() !== '' && this.password().length >= 8;
    }
    return true;
  });

  /**
   * ngOnInit, NOT the constructor — an `input()` still holds its default while
   * the constructor runs (D-074), so seeding there would render a blank create
   * form pointed at an existing account.
   */
  ngOnInit(): void {
    const existing = this.user();
    if (existing) {
      this.name.set(existing.name);
      this.email.set(existing.email);
      this.role.set(existing.role);
      this.departmentId.set(existing.departmentId ?? '');
    }
  }

  setRole(value: Role): void {
    this.role.set(value);
    this.errorMessage.set(null);
    // An Administrateur is global and the server clears any department on one,
    // so the value is DISCARDED rather than hidden — a retained one would be
    // sent, silently dropped, and leave the form disagreeing with the record.
    if (!ROLES_NEEDING_DEPARTMENT.includes(value)) {
      this.departmentId.set('');
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    const existing = this.user();
    const request = existing
      ? this.admin.updateUser(existing.id, this.changesAgainst(existing))
      : this.admin.createUser({
          name: this.name().trim(),
          email: this.email().trim(),
          password: this.password(),
          role: this.role(),
          ...(this.needsDepartment() ? { departmentId: this.departmentId() } : {}),
        });

    request.subscribe({
      next: (user) => {
        this.busy.set(false);
        // The password signal is dropped with the component; it is never held
        // beyond the request and never logged (rule 3).
        this.saved.emit(user);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le compte n'a pas pu être enregistré. Réessayez."),
        );
      },
    });
  }

  /** Only what changed — PATCH semantics, and it keeps FR-7 minimal. */
  private changesAgainst(existing: AdminUser) {
    const changes: Record<string, string> = {};
    const name = this.name().trim();

    if (name !== existing.name) {
      changes['name'] = name;
    }
    if (this.role() !== existing.role) {
      changes['role'] = this.role();
    }
    // Sent only for a role that HAS one: an Administrateur's is cleared by the
    // server, so sending '' would be a value the route would have to reject.
    if (this.needsDepartment() && this.departmentId() !== (existing.departmentId ?? '')) {
      changes['departmentId'] = this.departmentId();
    }

    return changes;
  }
}

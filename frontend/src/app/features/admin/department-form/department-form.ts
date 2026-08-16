import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { ApiError } from '../../../core/auth.service';
import { AdminService, Department } from '../admin.service';

/**
 * FR-13 — create or rename a department.
 *
 * One field, so one dialog serves both. Deactivation is NOT here: D-016 makes
 * it its own route and its own decision, and folding a state change into a
 * rename form is how a terminal action gets taken by someone who meant to fix
 * a typo — the same principle that keeps FR-16's closure out of the job
 * position form.
 *
 * Names are UNIQUE (D-016), so a clash is a 409 the server owns; this does no
 * client-side uniqueness check, which would need the full list and would still
 * race.
 */
@Component({
  selector: 'app-department-form',
  imports: [MatButtonModule],
  templateUrl: './department-form.html',
})
export class DepartmentForm implements OnInit {
  private readonly admin = inject(AdminService);

  /** Null = create. Non-null = rename that department. */
  readonly department = input<Department | null>(null);

  readonly saved = output<Department>();
  readonly dismissed = output<void>();

  readonly name = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly isRename = computed(() => this.department() !== null);
  readonly canSubmit = computed(() => !this.busy() && this.name().trim().length > 0);

  /** ngOnInit, not the constructor — D-074's default-value trap. */
  ngOnInit(): void {
    const existing = this.department();
    if (existing) {
      this.name.set(existing.name);
    }
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    const existing = this.department();
    const name = this.name().trim();
    const request = existing
      ? this.admin.renameDepartment(existing.id, name)
      : this.admin.createDepartment(name);

    request.subscribe({
      next: (department) => {
        this.busy.set(false);
        this.saved.emit(department);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le département n'a pas pu être enregistré. Réessayez."),
        );
      },
    });
  }
}

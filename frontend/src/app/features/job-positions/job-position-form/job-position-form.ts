import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';
import {
  JobPositionService,
  JobPosition,
  JobPositionInput,
  DepartmentOption,
  AssignableStatus,
  ASSIGNABLE_STATUSES,
} from '../job-position.service';

/**
 * FR-14 (create) and FR-15 (edit) — ONE dialog, because they are one form.
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE. The tenth run of the check, and the
 * fifth page running: `POST /job-positions` and `PATCH /job-positions/:id` have
 * both existed since 2026-08-05 (D-037/D-038), with D-030's active-department
 * rule, D-037's « Clôturé » refusal and the closed-position lock all already
 * enforced. This module had simply never been given a UI — the whole-spec audit
 * in D-078 is what surfaced it.
 *
 * *** TWO SERVER RULES SHAPE THIS FORM, AND NEITHER IS RE-IMPLEMENTED HERE. ***
 *
 * 1. « Clôturé » is NOT a status this form may set (D-037). The status picker
 *    offers Brouillon and Ouvert only; closing is FR-16's own action, and the
 *    update route 400s a `status: 'Clôturé'` rather than accepting it.
 * 2. The department must EXIST and be ACTIVE (D-016/D-030). The picker offers
 *    active departments, and — on edit — additionally names the position's
 *    current one even if it has since been deactivated, so the field shows the
 *    truth rather than an empty select. That option is marked and cannot be
 *    re-selected once left; the server would refuse it anyway, which is the
 *    half that actually enforces the rule (NFR-04).
 *
 * On EDIT only the CHANGED fields are sent. That is PATCH's own semantics, and
 * it is what keeps a position whose department was deactivated after the fact
 * editable in every other field.
 */
@Component({
  selector: 'app-job-position-form',
  imports: [ModalFocus, MatButtonModule, MatIconModule],
  templateUrl: './job-position-form.html',
})
export class JobPositionForm implements OnInit {
  private readonly positions = inject(JobPositionService);

  /** Null = FR-14 create. Non-null = FR-15 edit of that position. */
  readonly position = input<JobPosition | null>(null);

  readonly saved = output<JobPosition>();
  readonly dismissed = output<void>();

  protected readonly statuses = ASSIGNABLE_STATUSES;

  readonly title = signal('');
  readonly departmentId = signal('');
  readonly description = signal('');
  readonly requirements = signal('');
  readonly status = signal<AssignableStatus>('Brouillon');

  readonly departments = signal<DepartmentOption[]>([]);
  readonly loadingDepartments = signal(true);

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly isEdit = computed(() => this.position() !== null);

  /**
   * D-030's rule, mirrored as an affordance: only an active department may be
   * assigned. The position's CURRENT department is kept in the list even when
   * inactive, so an existing value is named rather than silently blank.
   */
  readonly departmentChoices = computed(() => {
    const current = this.position()?.departmentId ?? null;
    return this.departments().filter((d) => d.isActive || d.id === current);
  });

  /** True while the selected department is one the server would refuse. */
  readonly departmentInactive = computed(() => {
    const chosen = this.departmentId();
    const match = this.departments().find((d) => d.id === chosen);
    return match !== undefined && !match.isActive;
  });

  readonly canSubmit = computed(
    () =>
      !this.busy() &&
      this.title().trim().length > 0 &&
      this.departmentId().length > 0 &&
      this.description().trim().length > 0,
  );

  /**
   * ngOnInit, NOT the constructor. An `input()` still holds its DEFAULT while
   * the constructor runs (D-074): seeding from `position()` there would read
   * `null` on every edit and quietly render an empty create form pointed at an
   * existing position. A required input crashes; an optional one just lies.
   */
  ngOnInit(): void {
    const existing = this.position();
    if (existing) {
      this.title.set(existing.title);
      this.departmentId.set(existing.departmentId);
      this.description.set(existing.description);
      this.requirements.set(existing.requirements ?? '');
      // A closed position never reaches this form (the server 409s), so the
      // status is always one of the two assignable values here.
      this.status.set(existing.status === 'Ouvert' ? 'Ouvert' : 'Brouillon');
    }
    this.loadDepartments();
  }

  private loadDepartments(): void {
    this.loadingDepartments.set(true);
    // includeInactive, deliberately: `departmentChoices` does the narrowing, and
    // without it a position pointing at a deactivated department would lose its
    // NAME on exactly the record that most needs explaining.
    this.positions.listDepartments().subscribe({
      next: (departments) => {
        this.departments.set(departments);
        this.loadingDepartments.set(false);
      },
      error: () => {
        this.departments.set([]);
        this.loadingDepartments.set(false);
        this.errorMessage.set(
          'La liste des départements est indisponible, et un poste doit être rattaché à un département. Réessayez.',
        );
      },
    });
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    const existing = this.position();
    const request = existing
      ? this.positions.updatePosition(existing.id, this.changesAgainst(existing))
      : this.positions.createPosition(this.values());

    request.subscribe({
      next: (position) => {
        this.busy.set(false);
        this.saved.emit(position);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le poste n'a pas pu être enregistré. Réessayez."),
        );
      },
    });
  }

  private values(): JobPositionInput {
    const requirements = this.requirements().trim();
    return {
      title: this.title().trim(),
      departmentId: this.departmentId(),
      description: this.description().trim(),
      // Absent rather than an empty string: `requirements` is optional and an
      // empty string is a value.
      ...(requirements ? { requirements } : {}),
      status: this.status(),
    };
  }

  /** Only what actually differs — see the PATCH note on `updatePosition`. */
  private changesAgainst(existing: JobPosition): Partial<JobPositionInput> {
    const next = this.values();
    const changes: Partial<JobPositionInput> = {};

    if (next.title !== existing.title) {
      changes.title = next.title;
    }
    if (next.departmentId !== existing.departmentId) {
      changes.departmentId = next.departmentId;
    }
    if (next.description !== existing.description) {
      changes.description = next.description;
    }
    if ((next.requirements ?? '') !== (existing.requirements ?? '')) {
      changes.requirements = next.requirements ?? '';
    }
    if (next.status !== existing.status) {
      changes.status = next.status;
    }

    return changes;
  }
}

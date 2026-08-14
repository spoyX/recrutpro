import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError, AuthService } from '../../../core/auth.service';
import {
  JobPositionService,
  JobPosition,
  JobPositionFilters,
  DepartmentOption,
  JOB_POSITION_STATUSES,
} from '../job-position.service';
import { JobPositionForm } from '../job-position-form/job-position-form';
import { ClosePosition } from '../close-position/close-position';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';

/**
 * FR-17 — the job positions list, « filtrable par statut et département », and
 * the home of FR-14 (create), FR-15 (edit) and FR-16 (close).
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE. Every route this page uses has existed
 * since 2026-08-05 (D-037/D-038). The module had no UI at all until now — the
 * whole-spec audit recorded in D-078 is what found it, and the sidebar had been
 * saying « Postes — à venir » the entire time.
 *
 * UNPAGINATED, matching the endpoint: `listJobPositions` applies no limit or
 * offset, so there is no pager here. The count is what came back, not a claim
 * about a larger set.
 *
 * ROLES (D-038, D-068): Recruteur reads and writes, Administrateur reads and
 * writes nothing, Responsable hiérarchique gets 403 on the endpoint itself and
 * sees the server's own message. The write affordances below are affordances,
 * NOT permissions — NFR-04 puts authorisation on the server, which refuses a
 * write from an Administrateur regardless of what this page renders.
 *
 * FR-18/D-038: there is no delete action anywhere on this page, deliberately.
 * The route does not exist, and closure is the only removal path.
 */
@Component({
  selector: 'app-job-positions-list',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    StageChip,
    JobPositionForm,
    ClosePosition,
  ],
  templateUrl: './job-positions-list.html',
  styleUrl: './job-positions-list.scss',
})
export class JobPositionsList {
  private readonly positions = inject(JobPositionService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly statuses = JOB_POSITION_STATUSES;

  readonly rows = signal<JobPosition[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly departments = signal<DepartmentOption[]>([]);
  readonly filters = signal<JobPositionFilters>({});

  readonly isFiltered = computed(() => Object.values(this.filters()).some((v) => !!v));

  /**
   * Whether to OFFER the write actions — an affordance, not a permission.
   *
   * D-038 makes writes Recruteur-only and D-068 keeps the Administrateur
   * read-only across the whole system; both are enforced server-side. Hiding
   * these changes what is shown, never what is allowed (NFR-04, D-064).
   */
  readonly canWrite = computed(() => this.auth.currentUser()?.role === 'Recruteur');

  /** FR-14 open / FR-15 editing THIS position. Null in both closed states. */
  readonly editing = signal<JobPosition | null>(null);
  readonly creating = signal(false);
  readonly closingPosition = signal<JobPosition | null>(null);

  constructor() {
    this.load();
    // The department filter degrades to "Tous les départements" on failure;
    // losing a filter's options must not empty the list it filters.
    this.positions.listDepartments().subscribe({
      next: (departments) => this.departments.set(departments),
      error: () => this.departments.set([]),
    });
  }

  /** `departmentId` is all the API carries (D-071); the NAME comes from FR-13. */
  departmentName(departmentId: string): string {
    return this.departments().find((d) => d.id === departmentId)?.name ?? 'Département inconnu';
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.positions.listPositions(this.filters()).subscribe({
      next: (positions) => {
        this.rows.set(positions);
        this.loading.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);
        this.rows.set([]);

        // FR-2 expiry or FR-8 deactivation — signing in again is the only
        // useful action, so go there rather than showing a dead error.
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }

        // The server's own message first. A Responsable hiérarchique reaching
        // this route by URL gets D-038's 403, and « la liste est indisponible »
        // would describe a rule as an outage (NFR-09).
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : 'La liste des postes est momentanément indisponible. Réessayez.'),
        );
      },
    });
  }

  setFilter(key: keyof JobPositionFilters, value: string): void {
    this.filters.update((current) => ({ ...current, [key]: value || undefined }));
    this.load();
  }

  resetFilters(): void {
    this.filters.set({});
    this.load();
  }

  /**
   * D-037: a closed position is not editable and cannot be closed twice — the
   * server answers both with a 409. Mirrored so the actions are not present to
   * be clicked into one.
   */
  isManageable(position: JobPosition): boolean {
    return this.canWrite() && position.status !== 'Clôturé';
  }

  /** FR-14/FR-15/FR-16 all change what the list shows, so it is re-read. */
  onSaved(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.load();
  }

  onClosed(): void {
    this.closingPosition.set(null);
    this.load();
  }
}

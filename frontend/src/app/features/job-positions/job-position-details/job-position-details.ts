import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError, AuthService } from '../../../core/auth.service';
import { JobPositionService, JobPosition } from '../job-position.service';
import { CandidateService, CandidateListItem } from '../../candidates/candidate.service';
import { JobPositionForm } from '../job-position-form/job-position-form';
import { ClosePosition } from '../close-position/close-position';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';

/**
 * FR-14 to FR-17 — one job position, with the candidates attached to it.
 *
 * NO NEW ENDPOINT, confirmed by reading the payload first (the D-064/D-067/
 * D-069 discipline). `GET /job-positions/:id` already existed (D-038). What it
 * does NOT carry is resolved from other existing endpoints:
 *   - the department NAME comes from `GET /departments` (D-035, any role);
 *   - the candidates come from `GET /candidates?jobPositionId=…` (FR-24).
 *
 * Roles: the position itself is readable by Recruteur and Administrateur
 * (D-038, D-068). **The candidate list is Recruteur-only** — D-068 explicitly
 * did NOT widen it, so for an Administrateur that panel is absent by design
 * rather than broken, and says so.
 */
@Component({
  selector: 'app-job-position-details',
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
  templateUrl: './job-position-details.html',
  styleUrl: './job-position-details.scss',
})
export class JobPositionDetails {
  private readonly positions = inject(JobPositionService);
  private readonly candidates = inject(CandidateService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** Bound from the `:id` route parameter (`withComponentInputBinding`). */
  readonly id = input.required<string>();

  readonly position = signal<JobPosition | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly departmentName = signal<string | null>(null);

  readonly candidateRows = signal<CandidateListItem[]>([]);
  readonly candidateTotal = signal(0);
  /** True when the caller may not read the candidate list at all (D-068). */
  readonly candidatesForbidden = signal(false);

  /** How many of the total are shown, so the page never overstates itself. */
  readonly showingAll = computed(() => this.candidateRows().length >= this.candidateTotal());

  constructor() {
    // An effect, not the constructor body: a required input has no value while
    // the constructor runs (NG0950), and this also reloads if only :id changes.
    effect(() => this.fetch(this.id()));
  }

  load(): void {
    this.fetch(this.id());
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.candidatesForbidden.set(false);

    this.positions.getJobPosition(id).subscribe({
      next: (position) => {
        this.position.set(position);
        this.loading.set(false);
        this.resolveDepartment(position.departmentId);
        this.loadCandidates(id);
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);

        // FR-2 expiry or FR-8 deactivation — signing in again is the only
        // useful action (the D-064 rule).
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }

        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : 'Ce poste est momentanément indisponible. Réessayez.'),
        );
      },
    });
  }

  /** Losing the department NAME must not cost the page. */
  private resolveDepartment(departmentId: string): void {
    this.positions.listDepartments().subscribe({
      next: (departments) =>
        this.departmentName.set(departments.find((d) => d.id === departmentId)?.name ?? null),
      error: () => this.departmentName.set(null),
    });
  }

  private loadCandidates(jobPositionId: string): void {
    this.candidates.listCandidates({ jobPositionId }).subscribe({
      next: (page) => {
        this.candidateRows.set(page.items);
        this.candidateTotal.set(page.total);
      },
      error: (response: HttpErrorResponse) => {
        this.candidateRows.set([]);
        this.candidateTotal.set(0);
        // 403 is the EXPECTED answer for an Administrateur (D-068): the
        // position is theirs to read, the candidate list is not. Shown as a
        // stated rule, not as a failure.
        this.candidatesForbidden.set(response.status === 403);
      },
    });
  }

  // -------------------------------------------------------- FR-15, FR-16

  readonly editing = signal(false);
  readonly closing = signal(false);

  /**
   * Whether to OFFER the write actions — an affordance, not a permission.
   *
   * Writes are Recruteur-only (D-038) and D-068 keeps the Administrateur
   * read-only; both are the server's to enforce (NFR-04, D-064). The closed
   * check mirrors D-037: a clôturé position is neither editable nor
   * re-closable, and the server answers both with a 409.
   */
  isManageable(position: JobPosition): boolean {
    return this.auth.currentUser()?.role === 'Recruteur' && position.status !== 'Clôturé';
  }

  /**
   * Both actions change the record this page renders, and an edit may move the
   * position to another department — so the file is re-read rather than
   * patched in place from the response.
   */
  onWritten(): void {
    this.editing.set(false);
    this.closing.set(false);
    this.load();
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../../core/auth.service';
import {
  CandidateService,
  CandidateListItem,
  CandidateListQuery,
  CANDIDATE_PAGE_SIZE,
  CANDIDATE_STAGES,
} from '../candidate.service';
import { JobPositionService, JobPositionOption } from '../../job-positions/job-position.service';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';

type SortField = 'fullName' | 'currentStage' | 'registeredAt';

/**
 * FR-24 — the candidate list: « filtrable par poste, étape du pipeline et
 * plage de dates d'enregistrement ».
 *
 * NO NEW ENDPOINT. `GET /candidates` (D-041) already returns exactly the row
 * this table renders — name, email, phone, the populated poste title, stage,
 * registration date and `hasResume` — with the filters, pagination and sorting
 * the page needs. Confirmed against the payload before building, not assumed.
 *
 * Recruteur-only server-side (D-041, deliberately not widened by D-068). As on
 * every other page there is NO client-side permission check: NFR-04 puts
 * authorisation on the server, and a 403 is rendered as the server's own
 * message.
 */
@Component({
  selector: 'app-candidates-list',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    StageChip,
  ],
  templateUrl: './candidates-list.html',
  styleUrl: './candidates-list.scss',
})
export class CandidatesList {
  private readonly candidates = inject(CandidateService);
  private readonly positions = inject(JobPositionService);
  private readonly router = inject(Router);

  protected readonly stages = CANDIDATE_STAGES;
  protected readonly pageSize = CANDIDATE_PAGE_SIZE;

  readonly rows = signal<CandidateListItem[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  /** Populates the poste filter. Failure here must not break the list. */
  readonly positionOptions = signal<JobPositionOption[]>([]);

  readonly filters = signal<CandidateListQuery>({});
  readonly sortBy = signal<SortField>('registeredAt');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  /** 1-based first row on this page, for the "X–Y sur N" counter. */
  readonly rangeStart = computed(() => (this.total() === 0 ? 0 : this.offset() + 1));

  /**
   * Counts the rows ACTUALLY RENDERED, not the page size. With a page size of
   * 25 and 57 matches, `offset + pageSize` would claim "1–25" even on a page
   * that came back holding two rows — a number the user can see is wrong.
   */
  readonly rangeEnd = computed(() => Math.min(this.offset() + this.rows().length, this.total()));

  readonly hasPrevious = computed(() => this.offset() > 0);

  /** Is there anything after what is currently on screen? */
  readonly hasNext = computed(() => this.rangeEnd() < this.total());

  /** True when any filter is actually narrowing the list. */
  readonly isFiltered = computed(() => Object.values(this.filters()).some((v) => !!v));

  constructor() {
    this.load();
    this.positions.listOptions().subscribe({
      next: (options) => this.positionOptions.set(options),
      // The poste filter degrades to "Tous les postes" only. The candidate
      // list is the page; losing a filter's options must not empty it.
      error: () => this.positionOptions.set([]),
    });
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.candidates
      .listCandidates({
        ...this.filters(),
        limit: this.pageSize,
        offset: this.offset(),
        sortBy: this.sortBy(),
        sortDir: this.sortDir(),
      })
      .subscribe({
        next: (page) => {
          this.rows.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (response: HttpErrorResponse) => {
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);

          // FR-2 expiry or FR-8 deactivation — signing in again is the only
          // useful action, so go there rather than showing a dead error.
          if (response.status === 401) {
            void this.router.navigate(['/login']);
            return;
          }

          const body = response.error as ApiError | null;
          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : 'La liste des candidats est momentanément indisponible. Réessayez.'),
          );
        },
      });
  }

  /** Any filter change resets to page 1 — page 3 of a new filter is meaningless. */
  setFilter(key: keyof CandidateListQuery, value: string): void {
    this.filters.update((current) => ({ ...current, [key]: value || undefined }));
    this.offset.set(0);
    this.load();
  }

  resetFilters(): void {
    this.filters.set({});
    this.offset.set(0);
    this.load();
  }

  /** Clicking the active column flips direction; a new column starts descending. */
  sort(field: SortField): void {
    if (this.sortBy() === field) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(field);
      this.sortDir.set('desc');
    }
    this.offset.set(0);
    this.load();
  }

  previousPage(): void {
    if (!this.hasPrevious()) return;
    this.offset.update((o) => Math.max(0, o - this.pageSize));
    this.load();
  }

  nextPage(): void {
    if (!this.hasNext()) return;
    this.offset.update((o) => o + this.pageSize);
    this.load();
  }

  /** Screen-reader/visual indicator for the sorted column. */
  ariaSort(field: SortField): 'ascending' | 'descending' | null {
    if (this.sortBy() !== field) return null;
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }
}

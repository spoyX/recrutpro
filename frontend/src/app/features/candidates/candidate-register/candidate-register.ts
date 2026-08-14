import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../../core/auth.service';
import {
  CandidateService,
  RegisteredCandidate,
  RESUME_ACCEPT,
  RESUME_MAX_BYTES,
} from '../candidate.service';
import { JobPositionService, JobPositionOption } from '../../job-positions/job-position.service';
import { AppShell } from '../../../shared/app-shell/app-shell';

/**
 * FR-19 to FR-22 — register a candidate and attach their CV.
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE. The eighth run of the check:
 * `POST /candidates` and `POST /candidates/:id/resume` have both existed since
 * 2026-08-06, with the duplicate rule, the closed-position rule and the
 * magic-byte validation all already enforced. This page had simply never been
 * written — it was never on the frontend page list at all (D-076).
 *
 * A PAGE, not a dialog, unlike the last three. The distinction is what the
 * screen needs to exist: a dialog was right for scheduling, evaluating and
 * deciding because each acts on a row the caller already holds, so a route
 * would have had nothing to render on refresh. This creates a candidate from
 * nothing, so `/candidates/new` survives a reload perfectly well.
 *
 * TWO PHASES, and the page says so. The CV route needs a candidate id, so the
 * candidate must exist before a file can be attached. That is a real property
 * of the API, not a UI choice, and hiding it would mean a failed upload
 * silently looked like a failed registration when the candidate had in fact
 * been created.
 */
type Phase = 'identity' | 'resume' | 'done';

@Component({
  selector: 'app-candidate-register',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, AppShell],
  templateUrl: './candidate-register.html',
  styleUrl: './candidate-register.scss',
})
export class CandidateRegister {
  private readonly candidates = inject(CandidateService);
  private readonly positions = inject(JobPositionService);
  private readonly router = inject(Router);

  protected readonly accept = RESUME_ACCEPT;
  protected readonly maxBytes = RESUME_MAX_BYTES;

  readonly phase = signal<Phase>('identity');

  // ------------------------------------------------------- FR-19: identity

  readonly fullName = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  readonly jobPositionId = signal('');

  readonly positionOptions = signal<JobPositionOption[]>([]);
  readonly loadingPositions = signal(true);

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /**
   * FR-20 / D-004 — the duplicate warning, held as the SERVER's own message.
   *
   * Not a boolean. The message names the existing candidate and the date they
   * were registered, which is the « détail du doublon » FR-20 requires the
   * recruiter to see before choosing. Reducing it to a flag and writing our
   * own text would drop exactly the information the decision rests on.
   */
  readonly duplicateWarning = signal<string | null>(null);

  readonly canSubmitIdentity = computed(
    () =>
      !this.busy() &&
      this.fullName().trim().length > 0 &&
      this.email().trim().length > 0 &&
      this.phone().trim().length > 0 &&
      this.jobPositionId().length > 0,
  );

  // -------------------------------------------------------- FR-21: the CV

  readonly created = signal<RegisteredCandidate | null>(null);
  readonly file = signal<File | null>(null);
  readonly uploadPercent = signal<number | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly resumeAttached = signal(false);

  constructor() {
    // Safe in the constructor: this component reads no `input()`, so there is
    // no default to be caught holding (the D-074 trap). Stated rather than
    // left to be re-derived by the next reader.
    this.loadPositions();
  }

  private loadPositions(): void {
    this.loadingPositions.set(true);
    this.positions.listOptions().subscribe({
      next: (options) => {
        // FR-16: a closed position accepts no new candidate, and the server
        // refuses one — so offering it here could only produce a 409. The
        // list endpoint is deliberately unfiltered (it also feeds the FR-24
        // filter, where closed postings must appear), so the narrowing is
        // this caller's to do.
        this.positionOptions.set(options.filter((p) => p.status !== 'Clôturé'));
        this.loadingPositions.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.loadingPositions.set(false);
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }

        // The server's own message first. `GET /job-positions` is
        // Recruteur-only, so a Responsable landing on this route by URL gets a
        // 403 — and « la liste des postes est indisponible » would describe
        // that as an outage, which is both wrong and un-actionable (NFR-09).
        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            'La liste des postes est indisponible, et un candidat doit être rattaché à un poste. Réessayez.',
        );
      },
    });
  }

  retryPositions(): void {
    this.errorMessage.set(null);
    this.loadPositions();
  }

  /** Any edit invalidates a duplicate warning raised about the previous values. */
  private clearDuplicate(): void {
    this.duplicateWarning.set(null);
    this.errorMessage.set(null);
  }

  setFullName(value: string): void {
    this.fullName.set(value);
    this.clearDuplicate();
  }

  setEmail(value: string): void {
    this.email.set(value);
    this.clearDuplicate();
  }

  setPhone(value: string): void {
    this.phone.set(value);
    this.clearDuplicate();
  }

  setJobPosition(value: string): void {
    this.jobPositionId.set(value);
    // The duplicate rule is (email, poste), so changing the poste asks a
    // genuinely different question — the old warning does not carry over.
    this.clearDuplicate();
  }

  /**
   * FR-19 / FR-20. `confirmDuplicate` is only ever true on a SECOND, explicit
   * attempt made after the recruiter has read the server's warning — never on
   * a first submission, and never as a silent retry.
   */
  submitIdentity(confirmDuplicate = false): void {
    if (!this.canSubmitIdentity()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.candidates
      .registerCandidate({
        fullName: this.fullName().trim(),
        email: this.email().trim(),
        phone: this.phone().trim(),
        jobPositionId: this.jobPositionId(),
        confirmDuplicate: confirmDuplicate || undefined,
      })
      .subscribe({
        next: (candidate) => {
          this.busy.set(false);
          this.duplicateWarning.set(null);
          this.created.set(candidate);
          this.phase.set('resume');
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          if (response.status === 401) {
            void this.router.navigate(['/login']);
            return;
          }

          const body = response.error as ApiError | null;

          // FR-20: a duplicate is a WARNING with an override, not a failure.
          // Kept off the error channel so it does not wear the "this cannot
          // proceed" red, and so the confirm button appears beside it.
          if (body?.error?.code === 'DUPLICATE_CANDIDATE') {
            this.duplicateWarning.set(body.error.message);
            return;
          }

          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : "Le candidat n'a pas pu être enregistré. Réessayez."),
          );
        },
      });
  }

  // --------------------------------------------------------------- FR-21

  chooseFile(files: FileList | null): void {
    this.file.set(files?.[0] ?? null);
    this.uploadError.set(null);
  }

  /**
   * FR-21 / FR-22 — attach the CV.
   *
   * There is deliberately NO client-side type check. D-007's real gate is the
   * magic-byte signature test, which no browser API performs: `File.type` is
   * the extension's declared MIME and an executable renamed to `.pdf` reports
   * `application/pdf` quite happily. `accept` on the input is a picker
   * convenience, nothing more, and the server's refusal is what is displayed.
   */
  uploadResume(): void {
    const candidate = this.created();
    const file = this.file();
    if (!candidate || !file || this.uploading()) {
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);
    this.uploadPercent.set(0);

    this.candidates.uploadResume(candidate.id, file).subscribe({
      next: (event) => {
        if (event.kind === 'progress') {
          this.uploadPercent.set(event.percent);
          return;
        }
        this.uploading.set(false);
        this.uploadPercent.set(100);
        this.resumeAttached.set(true);
        this.phase.set('done');
      },
      error: (response: HttpErrorResponse) => {
        this.uploading.set(false);
        this.uploadPercent.set(null);
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }
        const body = response.error as ApiError | null;
        this.uploadError.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le CV n'a pas pu être enregistré. Réessayez."),
        );
      },
    });
  }

  /** FR-21 is optional — a candidate may be registered without a CV. */
  skipResume(): void {
    this.phase.set('done');
  }

  openCandidate(): void {
    const candidate = this.created();
    if (candidate) {
      void this.router.navigate(['/candidates', candidate.id]);
    }
  }

  registerAnother(): void {
    this.fullName.set('');
    this.email.set('');
    this.phone.set('');
    // The poste is deliberately KEPT: registering several candidates against
    // one posting is the common case, and re-picking it every time is the
    // kind of friction that gets a form abandoned.
    this.created.set(null);
    this.file.set(null);
    this.uploadPercent.set(null);
    this.uploadError.set(null);
    this.resumeAttached.set(false);
    this.duplicateWarning.set(null);
    this.errorMessage.set(null);
    this.phase.set('identity');
  }
}

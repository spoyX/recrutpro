import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../../core/auth.service';
import { CandidateService, RESUME_ACCEPT, RESUME_MAX_BYTES } from '../candidate.service';
import { FileDropzone } from '../../../shared/file-dropzone/file-dropzone';

/**
 * FR-22 — replace a candidate's CV, or attach a first one after the fact.
 *
 * NO NEW ENDPOINT, NO BACKEND CHANGE and NO SERVICE CHANGE — the seventh page
 * running, and the twelfth time the check has said no. This is
 * `POST /candidates/:id/resume`, the same route FR-21 uses at registration, and
 * `CandidateService.uploadResume` already speaks it with progress reporting.
 *
 * *** THE ENDPOINT CHECK WAS GENUINELY OPEN HERE, AND READING THE SERVICE IS
 * WHAT ANSWERED IT. *** That the route exists says nothing about what a SECOND
 * call does — overwrite, refuse, or version. `uploadResumeForCandidate` does
 * this, in this order:
 *
 *   1. validate locally (magic bytes, size, MIME) and confirm the candidate,
 *   2. upload the new file to Cloudinary,
 *   3. THEN destroy the previous asset and flip its row to `isActive: false`,
 *   4. insert the new row as the active one.
 *
 * Two consequences the UI is built around, neither of which is guessable from
 * the route alone:
 *
 * **A failure leaves the existing CV in place.** Nothing touches the old
 * record until the new bytes are stored, so a rejected file or a dropped
 * connection is safe. The dialog promises exactly that, because a reader who
 * believes otherwise will not risk the click.
 *
 * **A 201 always means the new CV is live.** The remote delete is best-effort
 * and a Cloudinary failure is swallowed (worst case: one orphaned asset), so
 * the panel must not present success as conditional.
 *
 * Replacement IS one-way from here: the old row stays in MongoDB as history,
 * but its asset is gone and no route serves an inactive resume. Said plainly.
 *
 * NO client-side file-type check, deliberately (D-007/D-040). `File.type` is
 * the extension's claim and an executable renamed to `.pdf` reports
 * `application/pdf`; the magic-byte test is the real gate and its refusal is
 * what gets displayed. `accept` on the input is picker convenience only.
 */
@Component({
  selector: 'app-replace-resume',
  imports: [FileDropzone, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './replace-resume.html',
  styleUrl: './replace-resume.scss',
})
export class ReplaceResume {
  private readonly candidates = inject(CandidateService);

  readonly candidateId = input.required<string>();
  readonly candidateName = input.required<string>();
  /** Drives the wording only — the endpoint is the same either way. */
  readonly hasExisting = input<boolean>(false);

  readonly replaced = output<void>();
  readonly dismissed = output<void>();

  protected readonly accept = RESUME_ACCEPT;
  protected readonly maxBytes = RESUME_MAX_BYTES;

  readonly file = signal<File | null>(null);
  readonly percent = signal<number | null>(null);
  readonly uploading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly canSubmit = computed(() => this.file() !== null && !this.uploading());

  /**
   * 4.4 — what `app-file-dropzone` emits, whether picked or dropped.
   *
   * The old `chooseFile(FileList)` is gone: the dropzone owns the input and
   * hands over a single File, so a FileList never reaches this component.
   */
  chooseDropped(file: File | null): void {
    this.file.set(file);
    // A new choice invalidates the server's verdict on the previous one.
    this.errorMessage.set(null);
    this.percent.set(null);
  }

  submit(): void {
    const file = this.file();
    if (!file || this.uploading()) {
      return;
    }

    this.uploading.set(true);
    this.errorMessage.set(null);
    this.percent.set(0);

    this.candidates.uploadResume(this.candidateId(), file).subscribe({
      next: (event) => {
        if (event.kind === 'progress') {
          this.percent.set(event.percent);
          return;
        }
        this.uploading.set(false);
        this.percent.set(100);
        this.replaced.emit();
      },
      error: (response: HttpErrorResponse) => {
        this.uploading.set(false);
        // Back to null, not left at whatever fraction it reached: a bar frozen
        // at 60% beside an error reads as "partly uploaded", and nothing was.
        this.percent.set(null);

        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : "Le CV n'a pas pu être enregistré. Réessayez."),
        );
      },
    });
  }
}

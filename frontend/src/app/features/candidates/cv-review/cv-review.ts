import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import { CandidateService, CvReviewStage, CV_REVIEW_STAGES } from '../candidate.service';
import { StageChip } from '../../../shared/stage-chip/stage-chip';
import { ResumePreview } from '../../../shared/resume-preview/resume-preview';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-25 / FR-26 — the Recruteur's CV preselection.
 *
 * NO NEW ENDPOINT and NO BACKEND CHANGE — the fourth page running, and the
 * ninth time the check has said no. This is `PATCH /candidates/:id/stage`,
 * already in Section 9 and already built: D-042 established it as "the one
 * stage transition the caller's role owns", so the same route serves the
 * Recruteur here and the Responsable's final decision (D-051).
 *
 * A dialog on the candidate's file, for D-074's reason: it acts ON a candidate
 * whose record the page already holds, and the file already renders the
 * `rejectionReason` this writes.
 *
 * *** THE ASYMMETRY IS THE WHOLE TRAP, and it is the INVERSE of FR-29. ***
 * `rejectionReason` is MANDATORY on « Rejeté (CV) » and **FORBIDDEN** on
 * « Présélection CV validée » — the server refuses a motive on a pass with a
 * 400 rather than dropping it, because a rejection motive stored against a
 * candidate who was not rejected is a false statement in the record. The final
 * decision dialog built the day before requires its comment on BOTH outcomes,
 * so the muscle memory from it is wrong here. The form therefore shows the
 * motive field ONLY on the rejection branch.
 *
 * The transition is ONE-WAY: a candidate already reviewed is refused (409), not
 * re-transitioned. That is the server's guarantee, mirrored here only as an
 * affordance (NFR-04, D-064).
 */
@Component({
  selector: 'app-cv-review',
  imports: [ModalFocus, ResumePreview, MatButtonModule, MatIconModule, StageChip],
  templateUrl: './cv-review.html',
  styleUrl: './cv-review.scss',
})
export class CvReview {
  private readonly candidates = inject(CandidateService);

  readonly candidateId = input.required<string>();
  readonly candidateName = input.required<string>();
  /** FR-25's decision rests on the CV, so the file's link is offered here. */
  readonly resumeUrl = input<string | null>(null);

  readonly reviewed = output<void>();
  readonly dismissed = output<void>();

  protected readonly outcomes = CV_REVIEW_STAGES;

  readonly outcome = signal<CvReviewStage | null>(null);
  readonly reason = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly isRejection = computed(() => this.outcome() === 'Rejeté (CV)');

  /**
   * FR-26's motive is required ONLY on the rejection branch — the client half
   * of a rule the server owns. Trimmed, because a motive of spaces is not a
   * motive and `reviewCandidateCv` refuses it too.
   */
  readonly canSubmit = computed(() => {
    if (this.busy() || this.outcome() === null) {
      return false;
    }
    return this.isRejection() ? this.reason().trim().length > 0 : true;
  });

  setOutcome(value: CvReviewStage): void {
    this.outcome.set(value);
    this.errorMessage.set(null);
    // Switching back to a validation DISCARDS any motive already typed, rather
    // than keeping it hidden: the server forbids a motive on a pass (D-042), so
    // a retained value would be sent and refused — a 400 the reader could not
    // see the cause of, because the field that caused it is no longer on screen.
    if (value !== 'Rejeté (CV)') {
      this.reason.set('');
    }
  }

  submit(): void {
    const outcome = this.outcome();
    if (!outcome || !this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.candidates
      .reviewCv(
        this.candidateId(),
        outcome,
        // Only ever sent on a rejection — never an empty string on a pass.
        outcome === 'Rejeté (CV)' ? this.reason().trim() : undefined,
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reviewed.emit();
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          const body = response.error as ApiError | null;
          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : "La décision n'a pas pu être enregistrée. Réessayez."),
          );
        },
      });
  }
}

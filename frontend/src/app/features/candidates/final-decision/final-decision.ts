import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import { CandidateService, FinalDecisionStage, FINAL_DECISION_STAGES } from '../candidate.service';
import { StageChip } from '../../../shared/stage-chip/stage-chip';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-29 / FR-39 — the final Accepté / Rejeté decision.
 *
 * NO NEW ENDPOINT. The check ran for the seventh time before a line was
 * written: this is `PATCH /candidates/:id/stage`, already in Section 9 and
 * already built, which executes the ONE transition the caller's role owns
 * (D-051). There is no `/decision` route to add, and the candidate file the
 * dialog opens from already carries the stage, the evaluation the decision
 * rests on, and the decision fields it will fill in. **No backend change.**
 *
 * A dialog on the candidate's file, for D-074's reason: the decision is an
 * action ON a candidate, and the file is where the evidence for it already is.
 *
 * THIS IS IRREVERSIBLE. « Accepté » and « Rejeté » are terminal in Section 8's
 * pipeline and no route un-sets them. So the outcome is CHOSEN, then confirmed
 * separately — never one click — and the chosen outcome is previewed with the
 * very `StageChip` the file will render afterwards, so the reader sees the
 * terminal state they are about to write, in its real colour.
 */
@Component({
  selector: 'app-final-decision',
  imports: [ModalFocus, MatButtonModule, MatIconModule, StageChip],
  templateUrl: './final-decision.html',
  styleUrl: './final-decision.scss',
})
export class FinalDecision {
  private readonly candidates = inject(CandidateService);

  readonly candidateId = input.required<string>();
  readonly candidateName = input.required<string>();

  readonly decided = output<void>();
  readonly dismissed = output<void>();

  protected readonly outcomes = FINAL_DECISION_STAGES;

  readonly outcome = signal<FinalDecisionStage | null>(null);
  readonly comment = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /**
   * FR-29's comment is mandatory for BOTH outcomes — the client half of a rule
   * the server owns. Trimmed, because a comment of spaces is not a comment and
   * `decideFinalOutcome` refuses it too.
   */
  readonly canSubmit = computed(
    () => !this.busy() && this.outcome() !== null && this.comment().trim().length > 0,
  );

  setOutcome(value: FinalDecisionStage): void {
    this.outcome.set(value);
    this.errorMessage.set(null);
  }

  submit(): void {
    const outcome = this.outcome();
    // Guards the same two conditions the template disables on, so a
    // programmatic call cannot skip them either. The server refuses regardless.
    if (!outcome || !this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.candidates.decideOutcome(this.candidateId(), outcome, this.comment().trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.decided.emit();
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

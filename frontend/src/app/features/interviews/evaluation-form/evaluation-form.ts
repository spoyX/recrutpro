import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiError } from '../../../core/auth.service';
import { ResumePreview } from '../../../shared/resume-preview/resume-preview';
import {
  InterviewService,
  InterviewListItem,
  EvaluationCriterion,
  EVALUATION_CRITERIA,
  SCORE_SCALE,
} from '../interview.service';

/**
 * FR-36 / FR-37 — the evaluation form for one interview.
 *
 * NO NEW ENDPOINT, and specifically **`GET /interviews/:id` was not built.**
 * Checked before writing a line, the sixth time this check has run: the FR-35
 * list row already carries the candidate's name, the poste, the slot and the
 * CV link, which is everything this form displays. Building a detail route to
 * re-fetch data the caller is already holding would have been the definition
 * of speculative.
 *
 * That is also why this is a DIALOG on the schedule rather than a page at
 * `/interviews/:id/evaluation`: a route reached by direct URL or survived
 * refresh would have no row to render, and *that* is what would have forced the
 * detail endpoint into existence. Same shape as FR-34's cancellation prompt.
 *
 * FR-37 is enforced in BOTH places on purpose. Here the submit button stays
 * disabled until all three scores are set, so the recruiter is never invited to
 * fail; on the server `parseScores` refuses the request outright with
 * `MISSING_REQUIRED_SCORES`. The client half is courtesy, the server half is
 * the rule (NFR-04) — and both are verified, the server half by posting past
 * this component.
 */
@Component({
  selector: 'app-evaluation-form',
  imports: [ResumePreview, DatePipe, MatButtonModule, MatIconModule],
  templateUrl: './evaluation-form.html',
  styleUrl: './evaluation-form.scss',
})
export class EvaluationForm {
  private readonly interviews = inject(InterviewService);

  readonly interview = input.required<InterviewListItem>();

  readonly submitted = output<void>();
  readonly dismissed = output<void>();

  protected readonly criteria = EVALUATION_CRITERIA;
  protected readonly scale = SCORE_SCALE;

  /**
   * Scores by criterion, absent until chosen. A partial record rather than a
   * record seeded with zeroes or threes: a pre-filled score is an opinion the
   * evaluator did not give, and FR-37 exists precisely to stop a form being
   * submitted with notes nobody entered.
   */
  readonly scores = signal<Partial<Record<EvaluationCriterion, number>>>({});
  readonly comments = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** FR-37 — the client half of the block. */
  readonly missing = computed(() =>
    this.criteria.filter((c) => this.scores()[c.key] === undefined),
  );
  readonly canSubmit = computed(() => !this.busy() && this.missing().length === 0);

  /**
   * The missing criteria, named. `label`, not `key`: the reader is told
   * « Communication », not « communication », and never the wire name the
   * server's own error happens to use.
   */
  readonly missingLabels = computed(() => this.missing().map((c) => c.label).join(', '));

  setScore(criterion: EvaluationCriterion, value: number): void {
    this.scores.update((current) => ({ ...current, [criterion]: value }));
    // A previous MISSING_REQUIRED_SCORES message describes a form that no
    // longer exists, so it goes as soon as the reader acts on it.
    this.errorMessage.set(null);
  }

  scoreOf(criterion: EvaluationCriterion): number | undefined {
    return this.scores()[criterion];
  }

  submit(): void {
    // Defence in depth against a click on a button the template already
    // disables — and the server refuses this shape regardless (D-048).
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.interviews
      .submitEvaluation(this.interview().id, {
        scores: this.scores() as Record<EvaluationCriterion, number>,
        comments: this.comments().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.submitted.emit();
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          const body = response.error as ApiError | null;
          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : "L'évaluation n'a pas pu être enregistrée. Réessayez."),
          );
        },
      });
  }
}

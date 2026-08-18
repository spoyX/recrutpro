import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, switchMap, of } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../../core/auth.service';
import { JobPositionService, JobPosition } from '../../job-positions/job-position.service';
import { InterviewService, InterviewerOption } from '../interview.service';
import { ModalFocus } from '../../../shared/modal-focus/modal-focus';

/**
 * FR-30 / FR-31 / FR-32 — schedule an interview for one candidate.
 *
 * Reached from the candidate's file, not from a standalone screen: FR-30 is an
 * action ON a candidate, and the candidate page already holds the poste this
 * dialog needs. That is also why there is no candidate picker.
 *
 * THE PICKER IS NOT THE RULE (D-030). FR-30 requires an active Responsable
 * hiérarchique of the poste's department; this narrows the list to those, but
 * the server re-checks every one of those three conditions on the way in. A
 * hand-crafted request with any other id is refused there, not here.
 *
 * The interviewer list comes from D-073's carve-out on `GET /users`. That is
 * the ONLY shape of the request a Recruteur may make — `role` is mandatory and
 * may only ask for responsables — so this component cannot be repurposed into
 * a directory browser by changing an argument.
 */
@Component({
  selector: 'app-schedule-interview',
  imports: [ModalFocus, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './schedule-interview.html',
})
export class ScheduleInterview {
  private readonly interviews = inject(InterviewService);
  private readonly positions = inject(JobPositionService);

  readonly candidateId = input.required<string>();
  readonly candidateName = input.required<string>();
  /** Null only if the candidate's poste was somehow removed (FR-18 blocks it). */
  readonly jobPositionId = input<string | null>(null);

  /** Emitted once the interview exists, so the caller can reload the file. */
  readonly scheduled = output<void>();
  readonly dismissed = output<void>();

  readonly interviewers = signal<InterviewerOption[]>([]);
  readonly loadingInterviewers = signal(true);
  readonly interviewerId = signal('');
  readonly scheduledAtLocal = signal('');

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** FR-31 — set only by a 409 SCHEDULING_CONFLICT, which is a warning. */
  readonly conflictMessage = signal<string | null>(null);

  readonly canSubmit = computed(
    () => !this.busy() && !!this.interviewerId() && !!this.scheduledAtLocal(),
  );

  /**
   * D-043 refuses a past slot. Fed to the native picker's `min` so the common
   * mistyped-year case is caught before a round trip — the server still owns
   * the rule, this only spares the user a rejection they can see coming.
   *
   * Built from LOCAL parts: `toISOString()` here would hand the picker a UTC
   * instant and mis-set the floor by the timezone offset.
   */
  readonly minLocal = (() => {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}`
    );
  })();

  /**
   * ngOnInit, NOT the constructor: an `input()` still holds its DEFAULT while
   * the constructor runs, so fetching there read `jobPositionId` as null and
   * quietly asked for every responsable in the company instead of the poste's
   * department. Same family as the NG0950 that pushed CandidateDetails onto an
   * effect — but an effect is not needed here, because this dialog is created
   * and destroyed per use rather than reused across inputs.
   */
  ngOnInit(): void {
    this.loadInterviewers();
  }

  /**
   * Two hops, both on endpoints that already exist: the candidate file carries
   * the poste's id but not its DEPARTMENT, and FR-30's eligibility is a
   * department rule. Widening `CandidateDetail` to carry `departmentId` would
   * have been one hop, but it changes a payload four other callers share for a
   * field only this dialog wants.
   */
  private loadInterviewers(): void {
    this.loadingInterviewers.set(true);

    const positionId = this.jobPositionId();
    const department$: Observable<JobPosition | null> = positionId
      ? this.positions.getJobPosition(positionId)
      : // No poste means no department to narrow by. Ask for every responsable
        // rather than for none: the server refuses an ineligible one at
        // scheduling time, so a wider list is a worse picker, not a hole.
        of(null);

    department$
      .pipe(switchMap((position) => this.interviews.listInterviewers(position?.departmentId)))
      .subscribe({
        next: (options) => {
          this.interviewers.set(options);
          this.loadingInterviewers.set(false);
        },
        error: (response: HttpErrorResponse) => {
          this.loadingInterviewers.set(false);
          const body = response.error as ApiError | null;
          this.errorMessage.set(
            body?.error?.message ??
              'La liste des responsables hiérarchiques est indisponible. Fermez et réessayez.',
          );
        },
      });
  }

  /**
   * Any change to WHAT is being booked drops a pending conflict override.
   *
   * Without this, confirming a conflict and then picking a different slot would
   * send `confirmDespiteConflict: true` for a slot the recruiter was never
   * warned about — silently suppressing the FR-31 check on a booking that may
   * have its own, different conflict.
   */
  setInterviewer(value: string): void {
    this.interviewerId.set(value);
    this.conflictMessage.set(null);
  }

  setSlot(value: string): void {
    this.scheduledAtLocal.set(value);
    this.conflictMessage.set(null);
  }

  submit(confirmDespiteConflict = false): void {
    if (!this.canSubmit()) {
      return;
    }

    // `datetime-local` yields a wall-clock string with no zone, which `Date`
    // parses as LOCAL — which is what the recruiter meant. The API takes an
    // instant, so the conversion happens here and not in the template.
    const at = new Date(this.scheduledAtLocal());
    if (Number.isNaN(at.getTime())) {
      this.errorMessage.set("La date et l'heure saisies ne sont pas valides.");
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    this.interviews
      .scheduleInterview({
        candidateId: this.candidateId(),
        interviewerId: this.interviewerId(),
        scheduledAt: at.toISOString(),
        confirmDespiteConflict: confirmDespiteConflict || undefined,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.scheduled.emit();
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          const body = response.error as ApiError | null;

          // FR-31/FR-32: a conflict is the one error that is not a failure —
          // it is a warning the recruiter may override. Kept off the error
          // channel so it does not wear the "this cannot proceed" red.
          if (body?.error?.code === 'SCHEDULING_CONFLICT') {
            this.conflictMessage.set(body.error.message);
            return;
          }

          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : "La planification a échoué. Réessayez."),
          );
        },
      });
  }
}

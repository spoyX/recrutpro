import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError, AuthService } from '../../../core/auth.service';
import { CandidateService, CandidateDetail } from '../candidate.service';
import { ScheduleInterview } from '../../interviews/schedule-interview/schedule-interview';
import { FinalDecision } from '../final-decision/final-decision';
import { CvReview } from '../cv-review/cv-review';
import { ReplaceResume } from '../replace-resume/replace-resume';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { StageChip } from '../../../shared/stage-chip/stage-chip';

/**
 * The Candidate Details page — a candidate's whole file on one screen.
 *
 * Calls exactly ONE endpoint (`GET /candidates/:id`, D-067), which composes the
 * position, the registrant, the CV flag, the interview history and each
 * interview's evaluation server-side. None of those three is reachable from
 * another route, so composing here would have meant inventing more API surface.
 *
 * NO client-side permission check, deliberately — the same rule as D-064.
 * NFR-04 puts authorisation on the server; a client role test would be both
 * redundant and false reassurance. The page renders what it is given, and a
 * Responsable hiérarchique simply receives null contact details.
 */
@Component({
  selector: 'app-candidate-details',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    StageChip,
    ScheduleInterview,
    FinalDecision,
    CvReview,
    ReplaceResume,
  ],
  templateUrl: './candidate-details.html',
  styleUrl: './candidate-details.scss',
})
export class CandidateDetails {
  private readonly candidates = inject(CandidateService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** Bound from the `:id` route parameter (`withComponentInputBinding`). */
  readonly id = input.required<string>();

  readonly candidate = signal<CandidateDetail | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    // An effect, NOT a constructor call: a required `input()` has no value yet
    // while the constructor runs (NG0950). It also means navigating from one
    // candidate straight to another reloads the file — the router reuses this
    // component when only the parameter changes, so `ngOnInit` would not fire
    // a second time and the page would keep showing the previous candidate.
    effect(() => this.fetch(this.id()));
  }

  /** Retry from the error banner, on whichever candidate is being viewed. */
  load(): void {
    this.fetch(this.id());
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.candidates.getCandidate(id).subscribe({
      next: (candidate) => {
        this.candidate.set(candidate);
        this.loading.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);

        // A 401 means the FR-2 inactivity window expired or the account was
        // deactivated mid-session (FR-8). Signing in again is the only useful
        // action, so go there rather than showing an error nobody can act on.
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }

        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : 'Ce dossier candidat est momentanément indisponible. Réessayez.'),
        );
      },
    });
  }

  /** FR-36's scale is 1–5, so a score renders as a filled/empty run of 5. */
  readonly scaleMax = [1, 2, 3, 4, 5];

  /** 4.1 — initials for the header avatar. Derived, never stored. */
  initials(name: string | null | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
    return (first + last).toUpperCase();
  }

  /**
   * 4.4 — the soonest PLANNED interview still ahead, or null.
   *
   * Computed from the interviews the page already loaded, so it costs no
   * request. Cancelled and past interviews are excluded: « prochain » means
   * one that is going to happen.
   */
  nextInterview(candidate: CandidateDetail): CandidateDetail['interviews'][number] | null {
    const now = Date.now();
    const upcoming = candidate.interviews
      .filter((i) => i.status === 'Planifié' && new Date(i.scheduledAt).getTime() > now)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return upcoming[0] ?? null;
  }

  // ------------------------------------------------------------- FR-22

  readonly replacing = signal(false);

  /**
   * Whether to OFFER the CV upload — an affordance, not a permission.
   *
   * `POST /candidates/:id/resume` sits below the Recruteur-only guard in
   * `candidate.routes.ts`, unlike the GET beside it, which D-047 opens to an
   * assigned Responsable for FR-35. So a Responsable may READ this candidate's
   * CV and may not replace it — the server enforces both, and this only
   * declines to show a button that would 403.
   *
   * Deliberately NOT gated on the pipeline stage. FR-22 names no stage, and a
   * wrong file attached to an accepted candidate is exactly when someone needs
   * to fix it.
   */
  canManageResume(): boolean {
    return this.auth.currentUser()?.role === 'Recruteur';
  }

  /** The file's `resume.hasResume` and `resume.url` both change, so re-read. */
  onResumeReplaced(): void {
    this.replacing.set(false);
    this.load();
  }

  // ------------------------------------------------------- FR-25, FR-26

  readonly reviewing = signal(false);

  /**
   * Whether to OFFER the CV preselection — an affordance, not a permission.
   *
   * Both halves mirror server rules (D-042): only from « Candidature reçue »,
   * and only for a Recruteur. The transition is one-way, so a candidate past
   * this point never sees the button — the server would 409 anyway.
   */
  canReviewCv(candidate: CandidateDetail): boolean {
    return (
      candidate.currentStage === 'Candidature reçue' &&
      this.auth.currentUser()?.role === 'Recruteur'
    );
  }

  /** FR-25 moves the stage (and may set a motive), so the file is re-read. */
  onReviewed(): void {
    this.reviewing.set(false);
    this.load();
  }

  // ---------------------------------------------------- FR-30, FR-31, FR-32

  readonly scheduling = signal(false);

  /**
   * Whether to OFFER scheduling — an affordance, not a permission check.
   *
   * The stage half is the same gate the server applies (only a « Présélection
   * CV validée » candidate can be scheduled), mirrored so the button is not
   * present to be clicked into a 409. The role half matches `canCancel` on the
   * interview list. Neither grants anything: `POST /interviews` is
   * Recruteur-only and re-checks the stage, so hiding this changes what is
   * shown, never what is allowed (NFR-04, D-064).
   */
  canSchedule(candidate: CandidateDetail): boolean {
    return (
      candidate.currentStage === 'Présélection CV validée' &&
      this.auth.currentUser()?.role === 'Recruteur'
    );
  }

  /** FR-27: scheduling moves the candidate's stage, so the file is re-read. */
  onScheduled(): void {
    this.scheduling.set(false);
    this.load();
  }

  // ------------------------------------------------------- FR-29, FR-39

  readonly deciding = signal(false);

  /**
   * Whether to OFFER the final decision — an affordance, not a permission.
   *
   * Both halves mirror rules the server applies (D-051): only from
   * « Évaluation complétée », and only for a Responsable hiérarchique. The
   * assignment half is deliberately NOT mirrored — `hasAssignedInterviewWith`
   * is a database question the client cannot answer, and pretending to would
   * be the false reassurance D-064 rules out. A non-assigned responsable who
   * reaches this button gets a 403, which the dialog shows.
   */
  canDecide(candidate: CandidateDetail): boolean {
    return (
      candidate.currentStage === 'Évaluation complétée' &&
      this.auth.currentUser()?.role === 'ResponsableHierarchique'
    );
  }

  /** FR-39 sets a TERMINAL stage and stamps `decidedAt`, so the file is re-read. */
  onDecided(): void {
    this.deciding.set(false);
    this.load();
  }
}

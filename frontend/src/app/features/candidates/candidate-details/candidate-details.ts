import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../../core/auth.service';
import { CandidateService, CandidateDetail } from '../candidate.service';
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
  imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, AppShell, StageChip],
  templateUrl: './candidate-details.html',
  styleUrl: './candidate-details.scss',
})
export class CandidateDetails {
  private readonly candidates = inject(CandidateService);
  private readonly router = inject(Router);

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
}

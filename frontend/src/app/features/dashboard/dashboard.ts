import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../core/auth.service';
import { DashboardService, Dashboard as DashboardData } from './dashboard.service';
import { AppShell } from '../../shared/app-shell/app-shell';
import { StatTile } from '../../shared/stat-tile/stat-tile';
import { StageChip } from '../../shared/stage-chip/stage-chip';
import { PipelineBreakdown } from '../../shared/pipeline-breakdown/pipeline-breakdown';

/**
 * FR-45, FR-46, FR-47 — the role-scoped dashboard. Replaces the placeholder
 * shipped with the Login page.
 *
 * ONE component for three shapes, because the API returns one discriminated
 * union (D-057) and the role is decided server-side. `@switch` on `role` is
 * the whole of the role logic: there is no client-side permission check here,
 * and there must not be — NFR-04 puts authorisation on the server, and the
 * client simply renders what it is given.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    StatTile,
    StageChip,
    PipelineBreakdown,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly dashboards = inject(DashboardService);
  private readonly router = inject(Router);

  readonly data = signal<DashboardData | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.dashboards.getDashboard().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);

        // A 401 means the session expired (FR-2's 30-minute inactivity window)
        // or the account was deactivated mid-session (FR-8). Either way the
        // only useful action is to sign in again, so go there rather than
        // showing an error the user cannot act on.
        if (response.status === 401) {
          void this.router.navigate(['/login']);
          return;
        }

        const body = response.error as ApiError | null;
        this.errorMessage.set(
          body?.error?.message ??
            (response.status === 0
              ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
              : 'Le tableau de bord est momentanément indisponible. Réessayez.'),
        );
      },
    });
  }

  // Logout and the topbar identity now live in `shared/app-shell`, which every
  // protected page wraps itself in — one place to change when D-065 is settled.

  /** FR-47 audit entries read as `UtilisateurCree`; space them for humans. */
  humanise(action: string): string {
    return action.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
}

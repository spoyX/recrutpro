import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { map } from 'rxjs';
import { ApiError } from '../../../core/auth.service';
import { AppShell } from '../../../shared/app-shell/app-shell';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { environment } from '../../../../environments/environment';

/** Mirrors `views/auditLog.view.ts`. D-033: who / what / when, and no payload. */
export interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
  /** Null-tolerant: one entry whose actor vanished must not break the page. */
  user: { id: string; name: string } | null;
}

/** The two enums the endpoint accepts. An unknown value is a 400, not ignored. */
const ACTIONS = [
  'UtilisateurCree',
  'UtilisateurModifie',
  'UtilisateurDesactive',
  'UtilisateurReactive',
  'MotDePasseReinitialise',
  'DepartementCree',
  'DepartementModifie',
  'DepartementDesactive',
  'DepartementReactive',
  'PosteCree',
  'PosteModifie',
  'PosteCloture',
  'EtapeCandidatModifiee',
  'EntretienPlanifie',
  'EntretienAnnule',
  'EvaluationSoumise',
] as const;

const TARGET_TYPES = [
  'User',
  'Department',
  'JobPosition',
  'Candidate',
  'Interview',
  'InterviewEvaluation',
] as const;

/**
 * UC-04 / FR-11 — the audit log.
 *
 * NO NEW ENDPOINT — the sixteenth run of the check. `GET /audit-logs` has
 * existed since D-060 and nothing called it.
 *
 * *** THE PAGE SIZE IS A FIXED CAP, NOT A PAGER, AND THE PAGE SAYS SO. ***
 * The endpoint returns at most `X-Page-Limit` (50) rows sorted newest-first,
 * with `X-Total-Count` carrying the total that MATCHED — and it accepts no
 * `offset`, deliberately: UC-04 is a recent-history view, not an export. So
 * when the total exceeds the cap the page states « les 50 plus récentes sur N »
 * rather than rendering a pager that cannot page or, worse, letting 50 rows
 * look like the whole history.
 *
 * D-033: an entry carries WHO, WHAT and WHEN and no payload. There is nothing
 * else to render, and a column inviting "what changed?" would be a promise the
 * data cannot keep — the absence is stated on the page instead.
 *
 * Administrateur-only, enforced by `router.use` (NFR-04).
 */
@Component({
  selector: 'app-audit-log',
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    AppShell,
    UserAvatar,
  ],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
})
export class AuditLog {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  protected readonly actions = ACTIONS;
  protected readonly targetTypes = TARGET_TYPES;

  readonly rows = signal<AuditEntry[]>([]);
  readonly total = signal(0);
  /** From `X-Page-Limit` — the server's cap, read rather than assumed. */
  readonly limit = signal(50);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly action = signal('');
  readonly targetType = signal('');

  readonly isFiltered = computed(() => !!this.action() || !!this.targetType());

  /**
   * The badge tint for an action.
   *
   * COLOUR IS THE SECOND CHANNEL, NEVER THE ONLY ONE — the badge always shows
   * the action name verbatim (`UtilisateurDesactive`, not "deactivated"), so
   * the tint only speeds up scanning a long page. Grouped by what the verb
   * DOES, read from its ending, because the sixteen action names are built by
   * the backend from the same handful of French participles.
   *
   * An unrecognised ending falls through to the neutral slate pill rather than
   * being guessed at: a new action must not be silently mis-tinted.
   */
  tone(action: string): string {
    if (/(Desactive|Annule|Cloture)$/.test(action)) return 'pill--amber';
    if (/(Modifie|Modifiee)$/.test(action)) return 'pill--sky';
    if (/(Cree|Planifie|Soumise|Reactive)$/.test(action)) return 'pill--green';
    if (/Reinitialise$/.test(action)) return 'pill--indigo';
    return '';
  }

  /** True when the cap is hiding matches, which the header must not conceal. */
  readonly truncated = computed(() => this.total() > this.rows().length);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    let params = new HttpParams();
    // Only what is set: an empty `action=` is an unknown enum value and the
    // server answers 400 rather than ignoring it.
    if (this.action()) {
      params = params.set('action', this.action());
    }
    if (this.targetType()) {
      params = params.set('targetType', this.targetType());
    }

    this.http
      .get<AuditEntry[]>(`${environment.apiUrl}/audit-logs`, {
        params,
        observe: 'response',
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(
        map((response) => ({
          items: response.body ?? [],
          total: Number(response.headers.get('X-Total-Count') ?? 0),
          limit: Number(response.headers.get('X-Page-Limit') ?? 50),
        })),
      )
      .subscribe({
        next: (page) => {
          this.rows.set(page.items);
          this.total.set(page.total);
          this.limit.set(page.limit);
          this.loading.set(false);
        },
        error: (response: HttpErrorResponse) => {
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);

          // FR-2 expiry or FR-8 deactivation.
          if (response.status === 401) {
            void this.router.navigate(['/login']);
            return;
          }

          const body = response.error as ApiError | null;
          this.errorMessage.set(
            body?.error?.message ??
              (response.status === 0
                ? 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.'
                : "Le journal d'audit est momentanément indisponible. Réessayez."),
          );
        },
      });
  }

  setAction(value: string): void {
    this.action.set(value);
    this.load();
  }

  setTargetType(value: string): void {
    this.targetType.set(value);
    this.load();
  }

  resetFilters(): void {
    this.action.set('');
    this.targetType.set('');
    this.load();
  }
}

import { Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';

/**
 * PLACEHOLDER — not the FR-45/FR-46/FR-47 dashboard.
 *
 * It exists for one reason: the login page needs a real destination so the
 * sign-in flow can be exercised end to end. The actual role-scoped dashboard
 * is the next task and should REPLACE this file rather than extend it.
 */
@Component({
  selector: 'app-dashboard-placeholder',
  template: `
    <main class="placeholder">
      <h1>Tableau de bord</h1>
      @if (auth.currentUser(); as user) {
        <p>Connecté en tant que {{ user.name }} — {{ user.role }}.</p>
      }
      <p class="placeholder__note">Cet écran arrive avec FR-45 à FR-47.</p>
    </main>
  `,
  styles: `
    .placeholder {
      max-width: var(--layout-max-width);
      margin: 0 auto;
      padding: var(--sp-xl) var(--sp-margin-desktop);
    }
    .placeholder__note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class DashboardPlaceholder {
  protected readonly auth = inject(AuthService);
}

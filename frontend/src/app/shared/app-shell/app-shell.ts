import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';

/**
 * The application chrome: DESIGN.md's 280px fixed sidebar plus the topbar,
 * wrapping every protected page's content via `<ng-content>`.
 *
 * DESIGN.md "Layout & Spacing": « use a sidebar-main layout where the sidebar
 * is fixed at 280px and the main content area fluidly expands ». D-064
 * deliberately deferred it while the Dashboard was the only page — a sidebar
 * with one destination is a column of dead links. With the Candidate Details
 * page there is finally somewhere to navigate between, so it lands here.
 *
 * SHARED, not per-page, for a specific reason beyond reuse: the topbar renders
 * the signed-in user's name and role, and D-065's known gap is that
 * `AuthService.currentUser` is populated only by `login()`, so it is blank
 * after a browser refresh. Keeping that markup in ONE component means closing
 * D-065 is a change to one file rather than a retrofit across every page.
 */
type Role = 'Administrateur' | 'Recruteur' | 'ResponsableHierarchique';

interface NavItem {
  label: string;
  icon: string;
  /** Null until that page is built — rendered disabled rather than as a link. */
  route: string | null;
  /** Omitted = every role. Otherwise only these roles get a live link. */
  roles?: readonly Role[];
}

/**
 * Unbuilt destinations are shown DISABLED rather than hidden or linked.
 * Hiding them would misrepresent the product's shape in a demo; linking them
 * would 404. Each becomes a live link as its page lands.
 *
 * A destination the CURRENT ROLE cannot use is disabled the same way, and for
 * the same reason — it would 403 rather than 404. The two cases carry
 * different hints ("à venir" vs "réservé"), because "not built yet" and "not
 * yours" are different facts and a user should not have to guess which.
 *
 * This is presentation, NOT authorisation. NFR-04 puts access control on the
 * server, which refuses these routes regardless of what the sidebar renders.
 */
const NAV: readonly NavItem[] = [
  // FR-45/FR-46/FR-47 give all three roles a dashboard.
  { label: 'Tableau de bord', icon: 'dashboard', route: '/dashboard' },
  // FR-24 is Recruteur-only (D-041), and D-068 deliberately did not widen it.
  { label: 'Candidats', icon: 'group', route: '/candidates', roles: ['Recruteur'] },
  { label: 'Postes', icon: 'work', route: null },
  { label: 'Entretiens', icon: 'event', route: null },
  { label: 'Rapports', icon: 'insights', route: null },
  { label: 'Utilisateurs', icon: 'manage_accounts', route: null },
  { label: "Journal d'audit", icon: 'receipt_long', route: null },
];

/** What the sidebar actually renders for one entry. */
interface ResolvedNavItem {
  label: string;
  icon: string;
  /** Non-null only when this role can actually reach the page. */
  href: string | null;
  hint: 'à venir' | 'réservé' | null;
}

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, MatButtonModule, MatIconModule],
  template: `
    <div class="shell">
      <nav class="sidebar" aria-label="Navigation principale">
        <span class="sidebar__brand">
          <span class="sidebar__logo" aria-hidden="true"><mat-icon>groups</mat-icon></span>
          RecrutPro
        </span>

        <ul class="sidebar__nav">
          @for (item of nav(); track item.label) {
            <li>
              @if (item.href) {
                <a
                  class="sidebar__link"
                  [routerLink]="item.href"
                  routerLinkActive="sidebar__link--active"
                  #active="routerLinkActive"
                  [attr.aria-current]="active.isActive ? 'page' : null"
                >
                  <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon>
                  {{ item.label }}
                </a>
              } @else {
                <span class="sidebar__link sidebar__link--disabled" aria-disabled="true">
                  <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon>
                  {{ item.label }}
                  @if (item.hint) {
                    <span class="sidebar__soon label-sm">{{ item.hint }}</span>
                  }
                </span>
              }
            </li>
          }
        </ul>
      </nav>

      <div class="shell__main">
        <header class="topbar">
          <div class="topbar__inner">
            <!--
              D-065: blank after a browser refresh, because currentUser is set
              only by login(). Data still loads — the session cookie is valid.
              Unfixed pending the human's choice; it lives here so the fix is
              one file.
            -->
            @if (auth.currentUser(); as user) {
              <span class="topbar__identity">
                <span class="topbar__name">{{ user.name }}</span>
                <span class="topbar__role label-sm">{{ user.role }}</span>
              </span>
            }

            <button matButton type="button" (click)="logout()">
              <mat-icon>logout</mat-icon>
              Se déconnecter
            </button>
          </div>
        </header>

        <main class="page">
          <ng-content />
        </main>
      </div>
    </div>
  `,
  styles: `
    .shell {
      display: flex;
      min-height: 100vh;
      align-items: stretch;
      // Nothing in this app scrolls the PAGE sideways; wide data tables scroll
      // inside their own wrapper. Even with every container measuring clean,
      // the root scroller still reveals a nested table's layout overflow, so
      // the outermost container clips it. clip rather than hidden: it does
      // not create a scroll container, so position:sticky still works inside.
      overflow-x: clip;
    }

    // DESIGN.md: sidebar FIXED at 280px, main content fluid.
    .sidebar {
      flex: 0 0 var(--layout-sidebar-width);
      width: var(--layout-sidebar-width);
      background-color: var(--mat-sys-surface-container-lowest);
      border-right: var(--border-level-1);
      box-shadow: var(--elevation-1); // DESIGN.md Level 1: cards AND sidebar
      padding: var(--sp-lg) var(--sp-md);
      display: flex;
      flex-direction: column;
      gap: var(--sp-lg);
    }

    .sidebar__brand {
      display: flex;
      align-items: center;
      gap: var(--sp-sm);
      padding: 0 var(--sp-sm);
      font: var(--mat-sys-title-large);
      color: var(--mat-sys-on-surface);
    }

    .sidebar__logo {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-default);
      background-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .sidebar__nav {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-xs);
    }

    .sidebar__link {
      display: flex;
      align-items: center;
      gap: var(--sp-sm);
      padding: var(--sp-sm) var(--sp-sm);
      border-radius: var(--radius-default);
      font: var(--mat-sys-label-large);
      color: var(--text-slate);
      text-decoration: none;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    a.sidebar__link:hover {
      background-color: var(--mat-sys-surface-container-low);
      color: var(--mat-sys-on-surface);
    }

    // DESIGN.md: primary is for "active states, critical navigation elements".
    .sidebar__link--active {
      background-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    a.sidebar__link--active:hover {
      background-color: var(--recrutpro-primary-dark);
      color: var(--mat-sys-on-primary);
    }

    .sidebar__link--disabled {
      color: var(--mat-sys-outline);
      cursor: default;
    }

    .sidebar__soon {
      margin-left: auto;
      color: var(--mat-sys-outline);
    }

    .shell__main {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .topbar {
      background-color: var(--mat-sys-surface-container-lowest);
      border-bottom: var(--border-level-1);
      box-shadow: var(--elevation-1);
    }

    .topbar__inner {
      max-width: var(--layout-max-width);
      margin: 0 auto;
      // width:100% is REQUIRED, not redundant. margin:0 auto sets auto
      // cross-axis margins, which disables flex stretch — without an explicit
      // width the item sizes to its content and takes the 1440px max-width
      // even inside a narrower column. It is only safe alongside the global
      // border-box in styles.scss; under content-box it measured 100% + 80px
      // of padding and pushed the page into horizontal scroll.
      // NOTE: never use backticks in this styles literal — they close it.
      width: 100%;
      padding: var(--sp-md) var(--sp-margin-desktop);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--sp-md);
    }

    .topbar__identity {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      line-height: 1.1;
    }

    .topbar__name {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface);
    }

    .topbar__role {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .page {
      max-width: var(--layout-max-width);
      margin: 0 auto;
      width: 100%; // same reason as .topbar__inner above
      padding: var(--sp-xl) var(--sp-margin-desktop) var(--sp-2xl);
      display: flex;
      flex-direction: column;
      gap: var(--sp-lg); // DESIGN.md gutter
    }

    // DESIGN.md: "Mobile Transition to a single-column layout with 16px side
    // margins." The fixed sidebar becomes a horizontal strip rather than
    // eating 280px of a phone screen.
    @media (max-width: 900px) {
      .shell {
        flex-direction: column;
      }

      .sidebar {
        flex-basis: auto;
        width: auto;
        border-right: none;
        border-bottom: var(--border-level-1);
      }

      .sidebar__nav {
        flex-direction: row;
        flex-wrap: wrap;
      }

      .sidebar__soon {
        display: none;
      }

      .topbar__inner,
      .page {
        padding-left: var(--sp-margin-mobile);
        padding-right: var(--sp-margin-mobile);
      }
    }
  `,
})
export class AppShell {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /**
   * The nav resolved against the signed-in role.
   *
   * KNOWN CONSEQUENCE OF D-065: `currentUser` is populated only by `login()`,
   * so after a browser REFRESH the role is unknown and every role-gated entry
   * renders disabled — « Candidats » included, even for a Recruteur who may
   * genuinely use it. Nothing breaks and nothing leaks (the page itself still
   * works if reached by URL, and the server is the authority either way), but
   * this is the point at which D-065 stops being purely cosmetic. Showing the
   * link on an unknown role was rejected: it would 403 for two of the three
   * roles, and a link that fails is what the disabled state exists to avoid.
   */
  protected readonly nav = computed<ResolvedNavItem[]>(() => {
    const role = this.auth.currentUser()?.role ?? null;

    return NAV.map((item) => {
      if (item.route === null) {
        return { label: item.label, icon: item.icon, href: null, hint: 'à venir' as const };
      }
      const allowed = !item.roles || (role !== null && item.roles.includes(role));
      return {
        label: item.label,
        icon: item.icon,
        href: allowed ? item.route : null,
        hint: allowed ? null : ('réservé' as const),
      };
    });
  });

  logout(): void {
    // FR-4. Idempotent server-side (D-026), so navigate regardless of outcome.
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}

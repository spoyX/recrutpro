import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth.service';
import { DepartmentDirectory } from '../../core/department-directory.service';
import { NotificationPanel } from '../notification-panel/notification-panel';
import { UserAvatar } from '../user-avatar/user-avatar';
import { ProfilePhoto } from '../profile-photo/profile-photo';

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
 * SHARED, not per-page: the topbar renders the signed-in user's name and role,
 * and the sidebar gates entries on that role. Keeping both in ONE component is
 * what made closing D-065 a single-file change (D-070) rather than a retrofit
 * across every page.
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
 * *** THE SIDEBAR SHOWS ONLY WHAT THIS ROLE CAN OPEN (D-108). ***
 *
 * It used to render unreachable destinations DISABLED — unbuilt ones as « à
 * venir », role-gated ones as « réservé » — on the reasoning that hiding them
 * would misrepresent the product's shape in a demo. The human overruled that
 * from the running app, and they are right about who the sidebar is for: it is
 * a place to GO, not a catalogue of the product. A Recruteur has no use for a
 * greyed « Journal d'audit » on every screen, and two of the seven entries
 * being permanently inert made the column read as half-broken.
 *
 * Nothing is hidden that this role could reach — the filter is exactly the
 * same predicate that used to decide `disabled`, so a page becomes visible for
 * precisely the roles it was already a live link for.
 *
 * STILL NOT AUTHORISATION. NFR-04 puts access control on the server, which
 * refuses these routes regardless of what the sidebar draws; typing the URL
 * directly still gets the same 403 it always did. This decides what is
 * OFFERED, never what is permitted (D-064).
 *
 * This is presentation, NOT authorisation. NFR-04 puts access control on the
 * server, which refuses these routes regardless of what the sidebar renders.
 */
const NAV: readonly NavItem[] = [
  // FR-45/FR-46/FR-47 give all three roles a dashboard.
  { label: 'Tableau de bord', icon: 'dashboard', route: '/dashboard' },
  // FR-24 is Recruteur-only (D-041), and D-068 deliberately did not widen it.
  { label: 'Candidats', icon: 'group', route: '/candidates', roles: ['Recruteur'] },
  // FR-14 to FR-17. D-038 opens the module's READS to Recruteur and
  // Administrateur and closes it to the Responsable hiérarchique entirely, so
  // the link is live for two roles and « réservé » for the third. Writes are
  // Recruteur-only (D-038/D-068) and the page hides its own write actions —
  // the entry itself is a read destination.
  { label: 'Postes', icon: 'work', route: '/job-positions', roles: ['Recruteur', 'Administrateur'] },
  // FR-33 for the Recruteur, FR-35 for the Responsable: the SAME route, with
  // the scope decided server-side (D-047). The Administrateur has neither FR.
  {
    label: 'Entretiens',
    icon: 'event',
    route: '/interviews',
    roles: ['Recruteur', 'ResponsableHierarchique'],
  },
  // SRS Section 1.5, user stories 22/23. All THREE roles: workflow step 9
  // names the Recruteur and the Responsable, and D-068 added the
  // Administrateur. No `roles` key, therefore — the same as the dashboard.
  { label: 'Rapports', icon: 'insights', route: '/reports' },
  // FR-6 to FR-13. Administrateur only — every route the page calls is, and
  // the two other roles would get a 403 rather than a 404.
  {
    label: 'Utilisateurs',
    icon: 'manage_accounts',
    route: '/admin/users',
    roles: ['Administrateur'],
  },
  // FR-11 / UC-04. Administrateur only (D-060), like the accounts module.
  {
    label: "Journal d'audit",
    icon: 'receipt_long',
    route: '/admin/audit-log',
    roles: ['Administrateur'],
  },
];

/**
 * What the sidebar actually renders for one entry.
 *
 * D-108: `href` is no longer nullable and there is no `hint`, because an entry
 * this role cannot reach is not rendered at all. See the note on `nav` below.
 */
interface ResolvedNavItem {
  label: string;
  icon: string;
  href: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    NotificationPanel,
    UserAvatar,
    ProfilePhoto,
  ],
  template: `
    <div class="shell">
      <nav class="sidebar" aria-label="Navigation principale">
        <!-- 1.7: the briefcase glyph, and 0.2's tagline. The four mockups gave
             four different taglines; « Portail RH » was chosen because it is
             the only French one, matching the rest of the application. -->
        <span class="sidebar__brand">
          <span class="sidebar__logo" aria-hidden="true"><mat-icon>work</mat-icon></span>
          <span class="sidebar__wordmark">
            <span class="sidebar__name">RecrutPro</span>
            <span class="sidebar__tagline label-sm">Portail RH</span>
          </span>
        </span>

        <ul class="sidebar__nav">
          @for (item of nav(); track item.label) {
            <li>
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
            </li>
          }
        </ul>
      </nav>

      <div class="shell__main">
        <header class="topbar">
          <div class="topbar__inner">
            <!--
              Populated on every load since D-070: the app asks GET /auth/me
              during bootstrap, so a refresh no longer empties this. Still
              guarded, because an anonymous visitor legitimately has no user.
            -->
            @if (auth.currentUser(); as user) {
              <!-- D-091: the topbar is the canonical "this is you", so it is
                   also where you change the photo. The AVATAR is the button,
                   not the whole identity block — the name and role are
                   information, and making them clickable would imply they lead
                   somewhere. D-089 rejected restructuring this block; nothing
                   moves here, a control is added inside it. -->
              <button
                type="button"
                class="topbar__photo"
                [attr.aria-label]="
                  user.avatarUrl ? 'Modifier votre photo de profil' : 'Ajouter une photo de profil'
                "
                (click)="photoOpen.set(true)"
              >
                <app-user-avatar [name]="user.name" [src]="user.avatarUrl" />
              </button>
              <span class="topbar__identity">
                <span class="topbar__name">{{ user.name }}</span>
                <span class="topbar__role label-sm">
                  {{ user.role }}
                  <!--
                    D-016: an Administrateur has NO department, and nothing is
                    rendered for them — see the comment on departmentName() below.
                  -->
                  @if (departmentName(); as department) {
                    <span class="topbar__sep" aria-hidden="true">·</span>
                    <span class="topbar__department">{{ department }}</span>
                  }
                </span>
              </span>
            }

            <!--
              FR-43/FR-44 and user story 33's badge. In the CHROME, not on a
              route: the badge has to be visible wherever the user is standing,
              and this is the one component every protected page wraps itself
              in. It also means the count is re-read on every navigation, since
              each page renders its own shell (D-081).
              Open to all three roles — D-054 gates on the RECIPIENT, not the
              role, so there is no nav-style role check here.
            -->
            <app-notification-panel />

            <!-- FR-10's voluntary half. Without it POST /auth/change-password
                 would be reachable only when an administrator has forced it —
                 the same "endpoint with no UI" gap the audit keeps finding.
                 NOTE: no backticks in this template literal — they close it. -->
            <a matButton routerLink="/change-password">
              <mat-icon>password</mat-icon>
              Mot de passe
            </a>

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

    @if (photoOpen()) {
      <app-profile-photo (dismissed)="photoOpen.set(false)" />
    }
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
      color: var(--mat-sys-on-surface);
    }

    .sidebar__wordmark {
      display: flex;
      flex-direction: column;
      line-height: 1.15;
    }

    .sidebar__name {
      font: var(--mat-sys-title-large);
    }

    .sidebar__tagline {
      color: var(--mat-sys-on-surface-variant);
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

    // DESIGN.md: primary is for "active states, critical navigation elements"
    // — carried by the ACCENT BAR here rather than by a full fill.
    //
    // The solid primary fill this replaces made the active nav item the
    // heaviest object on the entire screen, outweighing the page content it
    // was only meant to locate. A tint plus a 3px bar marks position just as
    // unambiguously and stops competing with the page.
    .sidebar__link--active {
      position: relative;
      background-color: var(--mat-sys-secondary-fixed);
      color: var(--mat-sys-on-secondary-fixed-variant);
      font-weight: 600;
    }

    .sidebar__link--active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 6px;
      bottom: 6px;
      width: 3px;
      border-radius: var(--radius-full);
      background-color: var(--mat-sys-primary);
    }

    a.sidebar__link--active:hover {
      background-color: var(--mat-sys-secondary-fixed-dim);
      color: var(--mat-sys-on-secondary-fixed-variant);
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

    .topbar__photo {
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      border-radius: 50%;
      display: inline-flex;

      &:focus-visible {
        outline: 2px solid var(--recrutpro-focus);
        outline-offset: 2px;
      }
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
      // The role and the department sit on one line, separated by a dot.
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    // A separator, not information — aria-hidden in the template so a screen
    // reader reads "Recruteur Ventes" rather than "Recruteur middle dot Ventes".
    .topbar__sep {
      color: var(--mat-sys-outline);
    }

    .topbar__department {
      // Long department names must not push the notification bell off the bar.
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

      .topbar__inner,
      .page {
        padding-left: var(--sp-margin-mobile);
        padding-right: var(--sp-margin-mobile);
      }
    }
  `,
})
export class AppShell {
  /** D-091 — the profile-photo dialog, opened from the topbar avatar. */
  protected readonly photoOpen = signal(false);

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly departments = inject(DepartmentDirectory);

  /**
   * The signed-in user's department name, or null when there is nothing to say.
   *
   * NO NEW ENDPOINT, checked rather than assumed: `PublicUser` already carries
   * `departmentId`, and `GET /departments` is open to every authenticated role
   * (D-035 — it sits before the `requireRole(Administrateur)` guard in
   * department.routes.ts, because FR-14 has a Recruteur pick one).
   *
   * *** AN ADMINISTRATEUR RENDERS NOTHING HERE, DELIBERATELY. ***
   * D-016 makes `departmentId` optional for that role alone, because rule 2
   * scopes the other two BY department and an Administrateur is deliberately
   * unscoped. So there is no department to name — and labelling them
   * « Administration » would put a scope on screen that they do not have,
   * next to a role line that already reads « Administrateur ». It would be
   * both redundant and, in the one way that matters here, untrue. They keep
   * the role alone, which is exactly what the topbar showed before.
   *
   */
  private readonly departmentNames = toSignal(
    // Never even REQUESTED for an Administrateur — `toSignal` subscribes
    // eagerly, so the choice has to be made here rather than in the `computed`
    // below. Identity is already resolved at this point: D-070 runs
    // `restoreSession()` as an app initializer, before the first render, and
    // every protected page constructs its own shell (D-081).
    this.auth.currentUser()?.departmentId
      ? this.departments.names().pipe(
          // The directory rethrows so each caller degrades its own way — the
          // job-positions filter empties, and the topbar simply renders no
          // department. Without this the failure is UNHANDLED: the chrome must
          // never break over a label it could not resolve.
          catchError(() => of<ReadonlyMap<string, string>>(new Map())),
        )
      : of<ReadonlyMap<string, string>>(new Map()),
    { initialValue: new Map<string, string>() as ReadonlyMap<string, string> },
  );

  protected readonly departmentName = computed(() => {
    const id = this.auth.currentUser()?.departmentId ?? null;
    if (!id) {
      return null;
    }
    // Null until the list arrives, so the topbar never flashes a raw id.
    return this.departmentNames().get(id) ?? null;
  });

  /**
   * The nav resolved against the signed-in role.
   *
   * The role survives a refresh since D-070: `restoreSession()` runs as an app
   * initializer, so `currentUser` is set before the first render rather than
   * only by `login()`. That was D-065's escalation — a Recruteur who reloaded
   * lost the « Candidats » link to a page they were entitled to use.
   *
   * An UNKNOWN role (a genuinely anonymous visitor) still disables role-gated
   * entries rather than showing them: the link would 403 for two of the three
   * roles, and a link that fails is exactly what the disabled state avoids.
   */
  protected readonly nav = computed<ResolvedNavItem[]>(() => {
    const role = this.auth.currentUser()?.role ?? null;

    return NAV.filter(
      (item) => item.route !== null && (!item.roles || (role !== null && item.roles.includes(role))),
    ).map((item) => ({ label: item.label, icon: item.icon, href: item.route! }));
  });

  logout(): void {
    // FR-4. Idempotent server-side (D-026), so navigate regardless of outcome.
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}

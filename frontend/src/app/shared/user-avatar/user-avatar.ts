import { Component, computed, input, signal } from '@angular/core';

/**
 * D-091 — a person's face, or their initials when there is no photo.
 *
 * *** THE TWO INPUTS ARE NOT INTERCHANGEABLE, AND THE DISTINCTION IS
 * PERMANENT. ***
 *
 * `name` is whoever is being shown. `src` is a USER's profile image, and only
 * a User can ever have one: it comes from `User.avatarUrl`, uploaded by that
 * person through `POST /users/me/avatar`.
 *
 * A CANDIDATE is not a user. They have no account, they never sign in, and
 * there is no field on the Candidate model — nor any FR proposing one — that
 * could hold a photograph of them. So every candidate rendered by this
 * component passes `src` as null **by nature, not by omission**: initials are
 * not a fallback there, they are the finished design and always will be.
 *
 * That is worth stating because the reverse assumption was already made once.
 * Phase 4.1 added these circles for candidates with comments promising that
 * « Phase 4.3's real avatars will fall back to exactly this » — which read as
 * though a photo was coming for them. It is not, and a reader who believes it
 * is will go looking for a bug that does not exist.
 *
 * So: for a user, initials are what shows UNTIL a photo is uploaded. For a
 * candidate, initials are what shows, full stop.
 */
@Component({
  selector: 'app-user-avatar',
  template: `
    @if (src() && !failed()) {
      <img
        class="avatar avatar--image"
        [class.avatar--lg]="large()"
        [src]="src()"
        [alt]="'Photo de ' + name()"
        (error)="failed.set(true)"
      />
    } @else {
      <!-- aria-hidden: the initials are a decoration of a name that is already
           rendered beside them, so a screen reader would otherwise announce
           the same person twice, once as gibberish. -->
      <span class="avatar" [class.avatar--lg]="large()" aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
      }

      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background-color: var(--mat-sys-secondary-fixed);
        color: var(--mat-sys-on-secondary-fixed-variant);
        font: var(--mat-sys-label-small);
        letter-spacing: var(--recrutpro-tracking-label-sm);
        text-transform: uppercase;
        flex: none;
      }

      .avatar--image {
        /* The stored asset is already a 256px square (D-091), so this only
           guards against a future source that is not. */
        object-fit: cover;
        background-color: var(--mat-sys-surface-container-high);
      }

      .avatar--lg {
        width: 56px;
        height: 56px;
        font: var(--mat-sys-title-medium);
      }
    `,
  ],
})
export class UserAvatar {
  /** The person shown. Used for the initials and for the image's alt text. */
  readonly name = input<string | null | undefined>(null);

  /**
   * The proxy path from the API (`/api/v1/users/:id/avatar`), or null.
   *
   * NEVER a Cloudinary URL — D-091 keeps storage URLs server-side, and the
   * backend emits this path in their place.
   */
  readonly src = input<string | null | undefined>(null);

  readonly large = input(false);

  /**
   * A photo that fails to load falls back to initials rather than leaving a
   * broken-image glyph. Reachable if the asset is removed between the payload
   * being built and the image being requested.
   */
  protected readonly failed = signal(false);

  protected readonly initials = computed(() => {
    const parts = (this.name() ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    // First and LAST, not the first two: « Fatima Zahra Idrissi » is FI, not
    // FZ. Copied unchanged from the two Phase 4.1 implementations this
    // component replaces — the behaviour is settled, only its home moves.
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
    return (first + last).toUpperCase();
  });
}

import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * D-106 — the search box, shared by every list screen.
 *
 * One component because a search box is the same thing five times: a labelled
 * text input, a clear button, and a debounce so a request is not fired per
 * keystroke. Five copies would be five places to get the debounce wrong.
 *
 * *** IT DOES NOT KNOW WHETHER THE SEARCH IS LOCAL OR REMOTE. *** It emits a
 * debounced term and nothing else. /candidates sends it to the server because
 * that list is paginated and a client-side filter would silently miss every row
 * off the current page; /job-positions and /admin/users filter in the browser
 * because their endpoints return everything they have. The caller decides;
 * this only collects the term.
 */
@Component({
  selector: 'app-search-box',
  imports: [MatIconModule],
  template: `
    <div class="search">
      <mat-icon class="search__glyph" aria-hidden="true">search</mat-icon>
      <input
        #field
        class="search__input"
        type="search"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        [value]="term()"
        (input)="onInput($any($event.target).value)"
        (keydown.escape)="clear()"
      />
      @if (term()) {
        <button
          type="button"
          class="search__clear"
          aria-label="Effacer la recherche"
          (click)="clear()"
        >
          <mat-icon>close</mat-icon>
        </button>
      }
    </div>
  `,
  styles: [
    `
      .search {
        display: flex;
        align-items: center;
        gap: var(--sp-sm);
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-default);
        background-color: var(--mat-sys-surface-container-lowest);
        min-width: 0;

        /* DESIGN.md: on focus the border shifts to the focus blue with a soft
           outer glow. :focus-within because the INPUT takes focus, not this. */
        &:focus-within {
          border-color: var(--recrutpro-focus);
          box-shadow: 0 0 0 3px rgb(59 130 246 / 0.15);
        }
      }

      .search__glyph {
        flex: none;
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--mat-sys-outline);
      }

      .search__input {
        flex: 1 1 auto;
        min-width: 0;
        border: none;
        outline: none;
        background: none;
        font: var(--mat-sys-body-medium);
        color: var(--mat-sys-on-surface);

        /* The browser's own clear affordance would sit beside ours. */
        &::-webkit-search-cancel-button {
          display: none;
        }
      }

      .search__clear {
        display: grid;
        place-items: center;
        flex: none;
        /* WCAG 2.2 target size — a standalone control, not inline in prose. */
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--radius-full);
        background: none;
        color: var(--mat-sys-on-surface-variant);
        cursor: pointer;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &:hover {
          background-color: var(--mat-sys-surface-container-high);
          color: var(--mat-sys-on-surface);
        }
      }
    `,
  ],
})
export class SearchBox {
  readonly label = input('Rechercher');
  readonly placeholder = input('Rechercher…');

  /**
   * Milliseconds to wait after the last keystroke.
   *
   * 250ms is the default because /candidates sends the term to the server: one
   * request per character would be both wasteful and racy. A caller that
   * filters in the browser can pass 0 — there is nothing to race.
   */
  readonly debounceMs = input(250);

  /** The debounced term, trimmed. Empty string means "no search". */
  readonly search = output<string>();

  protected readonly term = signal('');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Cancel a pending emit if this goes away mid-debounce, so a destroyed
    // list never receives a term.
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    });
  }

  protected onInput(value: string): void {
    this.term.set(value);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const emit = (): void => this.search.emit(this.term().trim());
    if (this.debounceMs() <= 0) {
      emit();
      return;
    }
    this.timer = setTimeout(emit, this.debounceMs());
  }

  /** Escape or the cross clears it, and emits immediately — no one waits to un-search. */
  protected clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.term.set('');
    this.field()?.nativeElement.focus();
    this.search.emit('');
  }
}

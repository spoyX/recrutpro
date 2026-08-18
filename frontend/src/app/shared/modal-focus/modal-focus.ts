import {
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  output,
  AfterViewInit,
} from '@angular/core';
import { ConfigurableFocusTrapFactory, FocusTrap } from '@angular/cdk/a11y';

/**
 * Phase 5 finding A — modal dialog focus management, in ONE place.
 *
 * The audit measured this on a live dialog: `role="dialog"` and
 * `aria-modal="true"` were both present and correct, and **none of the
 * behaviour they promise existed**. Focus was never moved in (`activeElement`
 * stayed `BODY`), Tab reached the 24 controls behind the overlay, and Escape
 * did nothing. `aria-modal="true"` tells a screen reader the background is
 * unavailable while it remained fully reachable — the markup was lying.
 *
 * *** THE SELECTOR IS THE DESIGN. ***
 *
 * `[role="dialog"][aria-modal="true"]` attaches to every modal automatically,
 * so the logic is written once rather than patched into fourteen components.
 * It also EXCLUDES the one surface that must not be trapped: the notification
 * panel carries `role="dialog"` deliberately WITHOUT `aria-modal`, because it
 * is a non-modal popup — trapping it would strand a keyboard user in a dropdown
 * they should be able to tab out of. The existing markup already drew that
 * distinction correctly; this selector simply honours it.
 *
 * Inventory note: the audit said "11 dialogs". Counting `role="dialog"`
 * occurrences rather than files found **15 — 14 modal, 1 not**. Two page
 * components hold a dialog inline, which is why a file count undercounted.
 *
 * *** WHY CDK RATHER THAN A HAND-ROLLED TRAP. ***
 *
 * `@angular/cdk` is already a dependency (Material needs it). Its
 * `ConfigurableFocusTrapFactory` handles the parts that are easy to get subtly
 * wrong — tab-order wrapping via boundary anchors, elements that become
 * focusable later, and shadow DOM. Reimplementing that from a `keydown` handler
 * is more code and worse.
 *
 * *** ESCAPE EMITS RATHER THAN CLOSES, AND THAT IS DELIBERATE. ***
 *
 * Every dialog closes differently — some emit `dismissed`, some set a signal to
 * null, and at least one must NOT close mid-upload. A directive cannot know
 * which, and guessing (clicking whatever button says « Annuler ») would be
 * fragile magic. So the shared, universal part — trap, initial focus, restore —
 * is automatic, and the one genuinely per-dialog decision stays with the dialog.
 */
@Directive({
  selector: '[role="dialog"][aria-modal="true"]',
  exportAs: 'modalFocus',
  host: {
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class ModalFocus implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trapFactory = inject(ConfigurableFocusTrapFactory);
  private readonly destroyRef = inject(DestroyRef);

  /** Escape was pressed. The dialog decides what that means. */
  readonly escaped = output<void>();

  private trap: FocusTrap | null = null;

  /**
   * Whatever had focus when the dialog opened, so it can be handed back.
   * Captured in the constructor rather than in `ngAfterViewInit`: by the time
   * the view has initialised, focus may already have moved.
   */
  private readonly trigger = document.activeElement as HTMLElement | null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.trap?.destroy();

      // Restore focus to whatever opened the dialog. Without this, dismissing
      // drops focus to BODY and a keyboard user restarts from the top of the
      // page — which is the same defect at the other end of the interaction.
      // Guarded: the trigger can be gone if the dialog's own action removed the
      // row that owned it (a cancelled interview leaving the default list).
      if (this.trigger && this.trigger.isConnected && typeof this.trigger.focus === 'function') {
        this.trigger.focus();
      }
    });
  }

  ngAfterViewInit(): void {
    const element = this.host.nativeElement as HTMLElement;
    this.trap = this.trapFactory.create(element);

    // `focusInitialElementWhenReady` falls back to the container itself when a
    // dialog has no tabbable content, so focus always lands INSIDE.
    void this.trap.focusInitialElementWhenReady();
  }

  protected onEscape(event: Event): void {
    // Stopped here so an Escape meant for the dialog does not also reach a
    // parent listening for it — the interviews page has both a detail panel and
    // a cancel prompt, and one keypress must close one of them.
    event.stopPropagation();
    this.escaped.emit();
  }
}

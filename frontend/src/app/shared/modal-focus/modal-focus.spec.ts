import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { ModalFocus } from './modal-focus';

/**
 * Phase 5 finding A. The behaviour is verified end to end with real Tab and
 * Escape keys across all 14 modals; these tests pin the parts a unit test can
 * hold onto — the selector contract, and that Escape delegates rather than
 * decides.
 */
@Component({
  imports: [ModalFocus],
  template: `
    <button id="trigger" (click)="open.set(true)">ouvrir</button>

    @if (open()) {
      <div role="dialog" aria-modal="true" aria-labelledby="t" (escaped)="escapes.set(escapes() + 1)">
        <h2 id="t">Titre</h2>
        <input id="first" />
        <button id="last">Fermer</button>
      </div>
    }

    <!-- Non-modal: role="dialog" WITHOUT aria-modal. Must not be trapped. -->
    @if (popup()) {
      <div role="dialog" aria-labelledby="p">
        <h2 id="p">Popup</h2>
        <button id="popup-btn">x</button>
      </div>
    }
  `,
})
class Host {
  readonly open = signal(false);
  readonly popup = signal(false);
  readonly escapes = signal(0);
}

describe('ModalFocus — Phase 5 finding A', () => {
  let fixture: ComponentFixture<Host>;

  const dialog = (): HTMLElement | null => fixture.nativeElement.querySelector('[role="dialog"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('moves focus INSIDE the dialog when it opens', async () => {
    (fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement).focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // The CDK trap resolves asynchronously; whenStable covers it.
    expect(dialog()!.contains(document.activeElement)).toBeTrue();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('restores focus to the trigger when the dialog goes away', async () => {
    const trigger = fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;
    trigger.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    // Without this a keyboard user is dropped back to BODY and restarts from
    // the top of the page — the same defect at the other end of the interaction.
    expect(document.activeElement).toBe(trigger);
  });

  it('emits `escaped` rather than closing, because each dialog closes differently', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.escapes()).toBe(1);
    // The directive did NOT close it — the host decides. One dialog must stay
    // open mid-upload, which a directive cannot know.
    expect(dialog()).not.toBeNull();
  });

  it('stops the Escape event, so one keypress closes ONE dialog', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = spyOn(event, 'stopPropagation').and.callThrough();
    dialog()!.dispatchEvent(event);

    expect(stop).toHaveBeenCalled();
  });

  it('does NOT attach to a role="dialog" without aria-modal', async () => {
    // The notification panel is a non-modal popup on purpose. Trapping it would
    // strand a keyboard user in a dropdown they should be able to tab out of.
    const before = document.activeElement;
    fixture.componentInstance.popup.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // No trap ran, so focus is untouched.
    expect(document.activeElement).toBe(before);

    const popup = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.escapes()).toBe(0);
  });
});

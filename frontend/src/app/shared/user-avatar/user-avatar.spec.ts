import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { UserAvatar } from './user-avatar';

/**
 * D-091 — the shared avatar.
 *
 * The initials cases below came from `dashboard.spec.ts`, where they tested a
 * method this component replaced. They moved rather than being deleted: the
 * behaviour is unchanged and still worth pinning, it simply lives here now.
 */
@Component({
  imports: [UserAvatar],
  template: `<app-user-avatar [name]="name" [src]="src" [large]="large" />`,
})
class Host {
  name: string | null | undefined = 'Alice Martin';
  src: string | null | undefined = null;
  large = false;
}

describe('UserAvatar — D-091', () => {
  let fixture: ComponentFixture<Host>;

  const render = (patch: Partial<Host> = {}): void => {
    fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    fixture.detectChanges();
  };

  const img = (): HTMLImageElement | null => fixture.nativeElement.querySelector('img');
  const initials = (): HTMLElement | null => fixture.nativeElement.querySelector('span.avatar');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  describe('initials — the edge cases that would otherwise crash a row', () => {
    const shows = (name: string | null | undefined, expected: string): void => {
      render({ name });
      expect(initials()!.textContent!.trim()).toBe(expected);
    };

    it('handles one name, extra spaces, and nothing at all', () => {
      shows('Alice Martin', 'AM');
      // First and LAST, never the first two.
      shows('  Alice   Bernard Martin ', 'AM');
      shows('Cher', 'C');
      shows('', '?');
      shows(null, '?');
      shows(undefined, '?');
    });
  });

  describe('the photo', () => {
    it('renders the image when a src is given, and no initials beside it', () => {
      render({ src: '/api/v1/users/u1/avatar' });

      expect(img()).not.toBeNull();
      expect(img()!.getAttribute('src')).toBe('/api/v1/users/u1/avatar');
      // Both at once would show a letter behind a face on a slow load.
      expect(initials()).toBeNull();
    });

    it('names the person in the alt text rather than saying "avatar"', () => {
      render({ src: '/api/v1/users/u1/avatar', name: 'Claire Fontaine' });

      expect(img()!.getAttribute('alt')).toBe('Photo de Claire Fontaine');
    });

    it('falls back to initials if the image fails to load', () => {
      render({ src: '/api/v1/users/u1/avatar' });

      img()!.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      // A broken-image glyph is worse than the letters it replaced.
      expect(img()).toBeNull();
      expect(initials()!.textContent!.trim()).toBe('AM');
    });

    it('renders initials when src is null — a CANDIDATE, permanently', () => {
      render({ src: null });

      expect(img()).toBeNull();
      expect(initials()).not.toBeNull();
    });

    it('hides the initials from screen readers, but not the photo', () => {
      // The name is always rendered beside this, so announcing "AM" would read
      // the same person twice. A photo carries alt text instead.
      render({ src: null });
      expect(initials()!.getAttribute('aria-hidden')).toBe('true');

      render({ src: '/api/v1/users/u1/avatar' });
      expect(img()!.getAttribute('aria-hidden')).toBeNull();
    });
  });

  it('the large variant applies to both branches', () => {
    render({ large: true });
    expect(initials()!.classList).toContain('avatar--lg');

    render({ large: true, src: '/api/v1/users/u1/avatar' });
    expect(img()!.classList).toContain('avatar--lg');
  });
});

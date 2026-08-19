import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ResumePreview } from './resume-preview';

const URL_PATH = '/api/v1/candidates/c1/resume';

@Component({
  imports: [ResumePreview],
  template: `@if (show()) { <app-resume-preview [url]="url()" /> }`,
})
class Host {
  readonly url = signal<string | null>(URL_PATH);
  readonly show = signal(true);
}

describe('ResumePreview — Phase 4.4', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  const text = (): string => fixture.nativeElement.textContent ?? '';
  const frame = (): HTMLIFrameElement | null => fixture.nativeElement.querySelector('iframe');
  const toggle = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.preview__toggle');

  const open = (): void => {
    toggle().click();
    fixture.detectChanges();
  };

  const respondWith = (blob: Blob): void => {
    http.expectOne(URL_PATH).flush(blob);
    fixture.detectChanges();
  };

  const fail = (status: number, body: Blob | Object = new Blob()): void => {
    http.expectOne(URL_PATH).flush(body, { status, statusText: 'err' });
    fixture.detectChanges();
  };

  /**
   * Poll for the VALUE, not a fixed delay. `Blob.text()` is real async I/O
   * rather than a microtask, so a `setTimeout(0)` can fire BEFORE the body has
   * been decoded — which is exactly how this helper came to exist.
   */
  const until = async (contains: string, timeout = 2000): Promise<void> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      fixture.detectChanges();
      if (text().includes(contains)) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for « ${contains} »`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('fetches nothing until asked — a CV is not loaded just by opening the page', () => {
    http.expectNone(URL_PATH);
    expect(frame()).toBeNull();
  });

  it('sends the request WITH credentials, since the route is session-guarded', () => {
    open();

    const req = http.expectOne(URL_PATH);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob([new Uint8Array(4)], { type: 'application/pdf' }));
  });

  describe('a PDF', () => {
    it('renders in a frame from a blob: URL, NOT from the API route', () => {
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: 'application/pdf' }));

      const src = frame()!.getAttribute('src') ?? '';
      // The route answers `Content-Disposition: attachment` (verified live), so
      // an iframe pointed at it downloads instead of rendering. The blob has no
      // disposition.
      expect(src.startsWith('blob:')).toBeTrue();
      expect(src).not.toContain('/api/v1/');
    });

    it('does NOT sandbox the frame — the sandbox is what blocked the viewer', () => {
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: 'application/pdf' }));

      // D-105. This asserted `sandbox === ''` until 2026-08-19, on the reasoning
      // that "a PDF needs no script". The reasoning was about the wrong thing:
      // Chromium's PDF VIEWER is an internal extension that cannot initialise
      // in a sandboxed frame, so Edge refused the document and painted « This
      // page has been blocked » where the CV should be. Measured on the running
      // app: `sandbox=""`, `allow-scripts`, `allow-same-origin` and
      // `allow-scripts allow-same-origin` ALL give a null frame document; only
      // removing the attribute renders. The assertion is kept, inverted, so
      // re-adding it fails here rather than in front of a user.
      expect(frame()!.hasAttribute('sandbox')).toBeFalse();
    });

    it('and the guarantee the sandbox was standing in for still holds', () => {
      open();
      // What actually keeps hostile markup out of that frame: this component
      // builds one ONLY for a payload the server typed as a PDF. D-007 refuses
      // a file whose bytes are not a PDF/DOCX at upload, and the proxy replays
      // the stored Content-Type, so this is the third of three gates.
      respondWith(new Blob(['<script>alert(1)</script>'], { type: 'text/html' }));

      expect(frame()).toBeNull();
    });

    it('closing revokes the blob rather than pinning the file for the tab', () => {
      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: 'application/pdf' }));
      const src = frame()!.getAttribute('src')!;

      toggle().click();
      fixture.detectChanges();

      expect(revoke).toHaveBeenCalledWith(src);
      expect(frame()).toBeNull();
    });

    it('destroying the component revokes it too', () => {
      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: 'application/pdf' }));

      fixture.componentInstance.show.set(false);
      fixture.detectChanges();

      expect(revoke).toHaveBeenCalled();
    });
  });

  describe('a DOCX — half the accepted formats cannot be previewed at all', () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    it('says so plainly instead of rendering a frame that never paints', () => {
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: DOCX }));

      expect(frame()).toBeNull();
      expect(text()).toContain('document Word');
      expect(text()).toContain('Téléchargez-le');
    });

    it('is not treated as an error — nothing went wrong', () => {
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: DOCX }));

      expect(fixture.nativeElement.querySelector('.preview__error')).toBeNull();
    });

    it('decides from the RESPONSE type, not from the url', () => {
      // The payload carries no filename and the url ends in `/resume` for both
      // formats, so the content type is the only honest signal.
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: DOCX }));
      expect(frame()).toBeNull();

      toggle().click();
      fixture.detectChanges();
      open();
      respondWith(new Blob([new Uint8Array(8)], { type: 'application/pdf' }));
      expect(frame()).not.toBeNull();
    });
  });

  describe('refusals', () => {
    it('FR-35: a 403 explains the scope rather than showing a generic failure', () => {
      open();
      fail(403);

      // The body arrives as a Blob because responseType is blob, so the usual
      // error.error.message is unreadable — the status carries the meaning.
      expect(text()).toContain("dont vous menez l'entretien");
      expect(frame()).toBeNull();
    });

    it('a 404 says there is no CV', () => {
      open();
      fail(404);

      expect(text()).toContain("Aucun CV");
    });

    it('a 401 tells the reader their session expired', () => {
      open();
      fail(401);

      expect(text()).toContain('session');
    });

    it('an unreachable server is distinguished from a refusal', () => {
      open();
      fail(0);

      expect(text()).toContain('injoignable');
    });

    it("the server's OWN message replaces the fallback once the blob is decoded", async () => {
      // On a blob request the error body is itself a Blob — Angular's testing
      // controller refuses to fake a JSON one, which is how a dead
      // "read error.error.message" branch was found. It has to be read back.
      open();
      fail(
        403,
        new Blob([JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Message précis du serveur.' } })], {
          type: 'application/json',
        }),
      );

      // Synchronously: the status fallback, so the slot is never blank.
      expect(text()).toContain("dont vous menez l'entretien");

      await until('Message précis du serveur.');
    });

    it('a body that is not the Section 9 shape leaves the fallback in place', async () => {
      open();
      fail(500, new Blob(['<html>Gateway blew up</html>'], { type: 'text/html' }));

      // Give the decode every chance to overwrite it, then confirm it did not.
      await until("L'aperçu n'a pas pu être chargé");
      await new Promise((resolve) => setTimeout(resolve, 150));
      fixture.detectChanges();

      // Never shown raw.
      expect(text()).not.toContain('Gateway');
      expect(text()).toContain("L'aperçu n'a pas pu être chargé");
    });
  });

  it('renders nothing at all when there is no CV', () => {
    fixture.componentInstance.url.set(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.preview')).toBeNull();
    http.expectNone(URL_PATH);
  });
});

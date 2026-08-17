import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiError } from '../../core/auth.service';

/**
 * Phase 4.4 — read a candidate's CV without leaving the page.
 *
 * *** WHY THIS FETCHES BYTES INSTEAD OF POINTING AN IFRAME AT THE URL. ***
 *
 * The obvious build is `<iframe src="/api/v1/candidates/:id/resume">`. It does
 * not work, and the reason was MEASURED rather than assumed: that route answers
 * with `Content-Disposition: attachment` (verified live — the header is
 * `attachment; filename="cv-<id>.pdf"`). An iframe pointed at it triggers a
 * DOWNLOAD instead of rendering, so the reader gets a file in their downloads
 * folder and an empty frame.
 *
 * So the bytes are fetched with the session cookie, turned into a `blob:` URL,
 * and rendered from that. The blob is same-origin, carries no disposition, and
 * is revoked when this component goes away.
 *
 * *** NOTHING ABOUT THE PROXY IS ASSUMED FROM D-040. *** D-092 is why: the
 * avatar work inherited D-040's storage design and inherited a hole that D-040
 * did not have, because one parameter differed. So the resume route was
 * re-verified end to end before this was written — it returns the bytes
 * BYTE-FOR-BYTE (68 in, 68 out: `raw` really is unprocessed), never redirects,
 * exposes no Cloudinary URL in body or headers, refuses an anonymous caller
 * with 401, and enforces FR-35 for a Responsable with 403. All of that is what
 * makes this component's approach sound; none of it was taken on trust.
 *
 * *** PDF ONLY, AND NOT AS A SHORTCUT. *** FR-21 accepts PDF and DOCX, and no
 * browser renders DOCX. There is no honest preview for half the accepted
 * formats, so a DOCX is told plainly that it must be downloaded rather than
 * shown a frame that will never paint. The type comes from the RESPONSE's own
 * `Content-Type` (`blob.type`), not from a filename — the payload carries no
 * filename, and guessing one would be inventing a fact.
 */
@Component({
  selector: 'app-resume-preview',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './resume-preview.html',
  styleUrl: './resume-preview.scss',
})
export class ResumePreview {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * The API's own proxy path. Null when the candidate has no CV.
   *
   * Verified live: the interview list emits a `resumeUrl` on rows whose
   * candidate has NO resume (23 of them in the demo data), so a caller that
   * binds the url without checking `hasResume` gets a link that 404s. This
   * component therefore treats a null url as "nothing to show" and every
   * caller passes the gate explicitly.
   */
  readonly url = input.required<string | null>();

  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Set once the bytes are in, from the RESPONSE's Content-Type. */
  protected readonly mimeType = signal<string | null>(null);
  protected readonly frameUrl = signal<SafeResourceUrl | null>(null);

  private objectUrl: string | null = null;

  constructor() {
    // A blob URL lives until it is revoked or the document goes away. Leaving
    // it behind pins the whole file in memory for the tab's lifetime.
    inject(DestroyRef).onDestroy(() => this.revoke());
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.load();
  }

  protected close(): void {
    this.open.set(false);
    this.revoke();
    this.mimeType.set(null);
    this.errorMessage.set(null);
  }

  private load(): void {
    const url = this.url();
    if (!url || this.loading()) {
      return;
    }

    this.open.set(true);
    this.loading.set(true);
    this.errorMessage.set(null);

    this.http.get(url, { responseType: 'blob', withCredentials: true }).subscribe({
      next: (blob) => {
        this.loading.set(false);
        // The server's own answer about what this file is. Not a filename, not
        // an extension — neither of which the payload carries.
        this.mimeType.set(blob.type || null);

        if (blob.type !== 'application/pdf') {
          // No frame at all rather than an empty one. See the note above.
          return;
        }

        this.revoke();
        this.objectUrl = URL.createObjectURL(blob);
        // Angular blocks a `blob:` URL in [src] unless it is explicitly
        // trusted. It is ours: we created it from bytes this app just fetched.
        this.frameUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);
        this.showError(response);
      },
    });
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.frameUrl.set(null);
  }

  /**
   * The server's refusal, shown as the server worded it.
   *
   * *** THE ERROR BODY IS A BLOB HERE, ALWAYS. *** `responseType: 'blob'`
   * applies to failures too, so the usual `response.error.error.message` is
   * never a readable object on this request — a first version read it that way
   * and the branch could not execute. Angular's own testing controller refuses
   * to fake a JSON error body for a blob request, which is what exposed it.
   *
   * So the blob is read back and parsed. That matters rather than being
   * pedantry: every other screen shows the API's own message, and hardcoding
   * FR-35's wording here would leave a copy to drift the day the server's
   * changes. The status-based text is the FALLBACK, set synchronously so the
   * slot is never briefly blank, and overwritten once the body is decoded.
   */
  private showError(response: HttpErrorResponse): void {
    const fallback = this.statusMessage(response.status);
    this.errorMessage.set(fallback);

    const body: unknown = response.error;
    if (!(body instanceof Blob) || body.size === 0) {
      return;
    }

    void body
      .text()
      .then((raw) => {
        const parsed = JSON.parse(raw) as ApiError;
        if (parsed?.error?.message) {
          this.errorMessage.set(parsed.error.message);
        }
      })
      // A body that is not the Section 9 error shape leaves the fallback in
      // place; it is never shown raw.
      .catch(() => undefined);
  }

  private statusMessage(status: number): string {
    switch (status) {
      case 403:
        return "Vous ne pouvez consulter que les CV des candidats dont vous menez l'entretien.";
      case 404:
        return "Aucun CV n'a été téléversé pour ce candidat.";
      case 401:
        return 'Votre session a expiré. Reconnectez-vous, puis réessayez.';
      case 0:
        return 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.';
      default:
        return "L'aperçu n'a pas pu être chargé. Téléchargez le CV pour le consulter.";
    }
  }
}

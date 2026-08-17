import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Phase 4.4 — a drop target that is also a proper file field.
 *
 * *** IT DOES NOT CHECK THE FILE TYPE, AND MUST NOT LEARN TO. ***
 *
 * That is the one rule TASKS.md attaches to this work, and a drop zone is
 * exactly where it gets broken: it is tempting to reject a `.exe` on drop and
 * show a tidy red border. `File.type` is the EXTENSION'S CLAIM — an executable
 * renamed to `.pdf` reports `application/pdf` — so such a check would refuse
 * honest files while passing the one attack it appears to stop. D-007's
 * magic-byte test in the backend is the real gate, and the server's refusal is
 * what the reader must see. `accept` on the input below is picker convenience
 * and is described as such.
 *
 * THE SIZE IS CHECKED, and that is not an inconsistency. A length can be
 * measured honestly in the browser; a type cannot. The server enforces the same
 * cap authoritatively — this only saves pushing a doomed 40MB file up a hotel
 * connection first. Same split as the profile-photo dialog (D-091).
 *
 * The `<input type="file">` is still there and still focusable — it is merely
 * unstyled and covered. A drop zone that replaces the input rather than
 * decorating it is unusable by keyboard and invisible to a screen reader, and
 * dragging a file is a pointer gesture with no keyboard equivalent to fall
 * back on.
 */
@Component({
  selector: 'app-file-dropzone',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './file-dropzone.html',
  styleUrl: './file-dropzone.scss',
})
export class FileDropzone {
  /** Picker convenience only — never a gate. */
  readonly accept = input<string>('');
  readonly maxBytes = input.required<number>();
  readonly disabled = input(false);
  /** e.g. « PDF ou DOCX, 5 Mo maximum ». Rendered as the field's hint. */
  readonly hint = input<string>('');
  readonly inputId = input<string>('file-dropzone');

  readonly chosen = output<File | null>();

  protected readonly file = signal<File | null>(null);
  protected readonly dragging = signal(false);
  protected readonly sizeError = signal<string | null>(null);

  protected readonly humanSize = computed(() => {
    const chosen = this.file();
    if (!chosen) {
      return '';
    }
    const mo = chosen.size / (1024 * 1024);
    // Under a tenth of a mega, « 0,0 Mo » reads as empty. Show ko instead.
    return mo < 0.1
      ? `${Math.max(1, Math.round(chosen.size / 1024))} ko`
      : `${mo.toFixed(1).replace('.', ',')} Mo`;
  });

  protected onDragOver(event: DragEvent): void {
    if (this.disabled()) {
      return;
    }
    // Both are required: without them the browser navigates to the file and
    // the drop never reaches this component.
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging.set(false);
    if (this.disabled()) {
      return;
    }
    // Whatever was dropped, whatever it claims to be. The server decides.
    this.take(event.dataTransfer?.files ?? null);
  }

  protected onPick(files: FileList | null): void {
    this.take(files);
  }

  protected clear(): void {
    this.file.set(null);
    this.sizeError.set(null);
    this.chosen.emit(null);
  }

  private take(files: FileList | null): void {
    const chosen = files?.[0] ?? null;
    this.sizeError.set(null);

    if (chosen && chosen.size > this.maxBytes()) {
      const mo = Math.round(this.maxBytes() / (1024 * 1024));
      this.file.set(null);
      this.sizeError.set(
        `Ce fichier dépasse la taille maximale de ${mo} Mo. Compressez-le ou choisissez-en un autre.`,
      );
      this.chosen.emit(null);
      return;
    }

    this.file.set(chosen);
    this.chosen.emit(chosen);
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FileDropzone } from './file-dropzone';

const MAX = 5 * 1024 * 1024;

@Component({
  imports: [FileDropzone],
  template: `<app-file-dropzone
    inputId="test-file"
    accept="application/pdf"
    [maxBytes]="MAX"
    [disabled]="disabled()"
    hint="PDF ou DOCX, 5 Mo maximum"
    (chosen)="last.set($event); calls = calls + 1"
  />`,
})
class Host {
  readonly MAX = MAX;
  readonly disabled = signal(false);
  readonly last = signal<File | null | undefined>(undefined);
  calls = 0;
}

const file = (name: string, type: string, size = 32): File => {
  const f = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  // Size is read-only on File; a large fixture would otherwise need megabytes
  // of real bytes in the browser.
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const list = (f: File | null): FileList =>
  ({ 0: f, length: f ? 1 : 0, item: () => f }) as unknown as FileList;

describe('FileDropzone — Phase 4.4', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const zone = (): HTMLElement => fixture.nativeElement.querySelector('.drop');
  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input[type=file]');
  const text = (): string => fixture.nativeElement.textContent ?? '';

  const drop = (f: File | null): void => {
    const event = new Event('drop', { bubbles: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files: list(f) } });
    zone().dispatchEvent(event);
    fixture.detectChanges();
  };

  const pick = (f: File | null): void => {
    fixture.debugElement
      .query((n) => n.name === 'app-file-dropzone')
      .componentInstance.onPick(list(f));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('THE RULE: no client-side type check', () => {
    it('accepts a dropped .exe renamed to .pdf and hands it to the server', () => {
      // D-007's threat, exactly. `File.type` is the extension's claim, so a
      // browser check would refuse honest files and pass this one anyway. The
      // magic-byte test in the backend is the gate.
      drop(file('malware.pdf', 'application/pdf'));

      expect(host.last()).not.toBeNull();
      expect(host.last()!.name).toBe('malware.pdf');
    });

    it('accepts a type nothing claims to support, rather than pre-judging it', () => {
      drop(file('archive.zip', 'application/zip'));

      expect(host.last()!.name).toBe('archive.zip');
    });

    it('shows no type-related refusal of its own', () => {
      drop(file('notes.txt', 'text/plain'));

      expect(text()).not.toContain('format');
      expect(fixture.nativeElement.querySelector('.drop__error')).toBeNull();
    });

    it('`accept` is on the input as picker convenience only', () => {
      expect(input().getAttribute('accept')).toBe('application/pdf');
    });
  });

  describe('the size, which CAN be measured honestly', () => {
    it('refuses a file over the cap and emits null', () => {
      drop(file('huge.pdf', 'application/pdf', MAX + 1));

      expect(host.last()).toBeNull();
      expect(fixture.nativeElement.querySelector('.drop__error')!.textContent).toContain('5 Mo');
    });

    it('accepts one exactly at the cap — the boundary is inclusive', () => {
      drop(file('exact.pdf', 'application/pdf', MAX));

      expect(host.last()).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.drop__error')).toBeNull();
    });

    it('clears a previous size error when a good file follows', () => {
      drop(file('huge.pdf', 'application/pdf', MAX + 1));
      expect(fixture.nativeElement.querySelector('.drop__error')).not.toBeNull();

      drop(file('ok.pdf', 'application/pdf'));
      expect(fixture.nativeElement.querySelector('.drop__error')).toBeNull();
    });
  });

  describe('the two ways in', () => {
    it('picking through the input works the same as dropping', () => {
      pick(file('picked.pdf', 'application/pdf'));

      expect(host.last()!.name).toBe('picked.pdf');
    });

    it('the input is still present and focusable — dragging has no keyboard equivalent', () => {
      expect(input()).not.toBeNull();
      expect(input().id).toBe('test-file');
      expect(input().hasAttribute('hidden')).toBeFalse();
    });
  });

  describe('what it shows', () => {
    it('names the file and its size once chosen', () => {
      drop(file('Alice Martin CV.pdf', 'application/pdf', 2 * 1024 * 1024));

      expect(text()).toContain('Alice Martin CV.pdf');
      expect(text()).toContain('2,0 Mo');
    });

    it('shows ko rather than « 0,0 Mo » for a small file', () => {
      drop(file('tiny.pdf', 'application/pdf', 4 * 1024));

      expect(text()).toContain('4 ko');
    });

    it('arms visibly on dragover and disarms on dragleave', () => {
      zone().dispatchEvent(new Event('dragover', { bubbles: true }));
      fixture.detectChanges();
      expect(zone().classList).toContain('drop--over');

      zone().dispatchEvent(new Event('dragleave', { bubbles: true }));
      fixture.detectChanges();
      expect(zone().classList).not.toContain('drop--over');
    });

    it('clearing emits null and returns to the prompt', () => {
      drop(file('cv.pdf', 'application/pdf'));
      const before = host.calls;

      (fixture.nativeElement.querySelector('.drop__clear') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(host.last()).toBeNull();
      expect(host.calls).toBe(before + 1);
      expect(text()).toContain('Glissez un fichier ici');
    });

    it('renders the hint it was given', () => {
      expect(text()).toContain('PDF ou DOCX, 5 Mo maximum');
    });
  });

  describe('disabled', () => {
    it('ignores a drop and disables the input', () => {
      host.disabled.set(true);
      fixture.detectChanges();

      drop(file('cv.pdf', 'application/pdf'));

      expect(host.last()).toBeUndefined();
      expect(input().disabled).toBeTrue();
    });

    it('does not arm on dragover', () => {
      host.disabled.set(true);
      fixture.detectChanges();

      zone().dispatchEvent(new Event('dragover', { bubbles: true }));
      fixture.detectChanges();

      expect(zone().classList).not.toContain('drop--over');
    });
  });
});

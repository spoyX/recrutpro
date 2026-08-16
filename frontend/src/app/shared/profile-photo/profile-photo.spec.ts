import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AuthService, AuthenticatedUser } from '../../core/auth.service';
import { ProfilePhoto } from './profile-photo';
import { environment } from '../../../environments/environment';

const USER: AuthenticatedUser = {
  id: 'u1',
  name: 'Claire Fontaine',
  email: 'claire@example.com',
  role: 'ResponsableHierarchique',
  departmentId: 'd1',
  mustChangePassword: false,
  avatarUrl: null,
};

const AVATAR_URL = `${environment.apiUrl}/users/me/avatar`;

describe('ProfilePhoto — D-091', () => {
  let fixture: ComponentFixture<ProfilePhoto>;
  let http: HttpTestingController;
  let auth: AuthService;

  const jpeg = (bytes = 16): File =>
    new File([new Uint8Array(bytes)], 'me.jpg', { type: 'image/jpeg' });

  const create = (user: AuthenticatedUser = USER): void => {
    auth = TestBed.inject(AuthService);
    auth.currentUser.set(user);
    fixture = TestBed.createComponent(ProfilePhoto);
    fixture.detectChanges();
  };

  const choose = (file: File | null): void => {
    fixture.componentInstance.chooseFile(
      file ? ({ 0: file, length: 1, item: () => file } as unknown as FileList) : null,
    );
    fixture.detectChanges();
  };

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim().includes(label),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilePhoto],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts to /users/me/avatar — no id, so no other account is addressable', () => {
    create();
    choose(jpeg());

    button('Enregistrer')!.click();

    const req = http.expectOne(AVATAR_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBeTrue();
    req.flush({ ...USER, avatarUrl: '/api/v1/users/u1/avatar' });
  });

  it('replaces currentUser from the SERVER answer, not from an assumption', () => {
    create();
    choose(jpeg());
    button('Enregistrer')!.click();

    http.expectOne(AVATAR_URL).flush({ ...USER, avatarUrl: '/api/v1/users/u1/avatar' });

    expect(auth.currentUser()?.avatarUrl).toBe('/api/v1/users/u1/avatar');
  });

  it('refuses a file over 2 Mo locally, without a request', () => {
    create();

    choose(jpeg(2 * 1024 * 1024 + 1));

    expect(fixture.componentInstance.file()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('2 Mo');
    // Before AND after: nothing was sent, and the button stays unusable.
    http.expectNone(AVATAR_URL);
    expect(button('Enregistrer')!.disabled).toBeTrue();
  });

  it('does NOT check the file TYPE — that is the server’s magic-byte test', () => {
    create();
    // An executable renamed to .jpg reports image/jpeg. The browser cannot
    // tell; the point is that this component does not pretend to (D-007).
    const renamed = new File([new Uint8Array(8)], 'evil.jpg', { type: 'image/jpeg' });
    choose(renamed);

    button('Enregistrer')!.click();

    // It goes to the server, which is what decides.
    const req = http.expectOne(AVATAR_URL);
    req.flush(
      { error: { code: 'INVALID_FILE_CONTENT', message: 'Contenu invalide.' } },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    // And the SERVER's refusal is what the reader sees.
    expect(fixture.nativeElement.textContent).toContain('Contenu invalide.');
  });

  it('offers Retirer only when there is a photo', () => {
    create();
    expect(button('Retirer')).toBeUndefined();

    create({ ...USER, avatarUrl: '/api/v1/users/u1/avatar' });
    expect(button('Retirer')).toBeDefined();
  });

  it('Retirer sends a DELETE and clears the photo', () => {
    create({ ...USER, avatarUrl: '/api/v1/users/u1/avatar' });

    button('Retirer')!.click();

    const req = http.expectOne(AVATAR_URL);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...USER, avatarUrl: null });

    expect(auth.currentUser()?.avatarUrl).toBeNull();
  });

  it('shows the current photo, then the chosen one as an unsaved preview', () => {
    create({ ...USER, avatarUrl: '/api/v1/users/u1/avatar' });
    expect(fixture.nativeElement.textContent).toContain('Photo actuelle');

    choose(jpeg());

    expect(fixture.nativeElement.textContent).toContain('non enregistré');
    expect(fixture.componentInstance.previewUrl()).not.toBeNull();
  });

  it('revokes the object URL rather than leaking a blob per re-pick', () => {
    create();
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();

    choose(jpeg());
    const first = fixture.componentInstance.previewUrl();
    choose(jpeg(32));

    expect(revoke).toHaveBeenCalledWith(first!);
  });

  it('a failure leaves the dialog open with the message', () => {
    create();
    choose(jpeg());
    button('Enregistrer')!.click();

    http
      .expectOne(AVATAR_URL)
      .flush(
        { error: { code: 'STORAGE_UNAVAILABLE', message: 'Stockage non configuré.' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Stockage non configuré.');
    expect(fixture.componentInstance.busy()).toBeFalse();
  });
});

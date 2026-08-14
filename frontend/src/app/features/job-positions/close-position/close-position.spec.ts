import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ClosePosition } from './close-position';
import { JobPosition } from '../job-position.service';
import { environment } from '../../../../environments/environment';

/** FR-16 — closure is its OWN action, and it is not reversible. */
describe('ClosePosition (FR-16)', () => {
  let fixture: ComponentFixture<ClosePosition>;
  let http: HttpTestingController;

  const ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const URL = `${environment.apiUrl}/job-positions/${ID}/close`;

  const open = (): void => {
    fixture = TestBed.createComponent(ClosePosition);
    fixture.componentRef.setInput('positionId', ID);
    fixture.componentRef.setInput('title', 'Développeur Angular');
    fixture.detectChanges();
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClosePosition],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('issues NO request when it opens — it asks first', () => {
    open();
    expect(http.match(() => true).length).toBe(0);
  });

  it('states all three consequences, since none is recoverable from the UI', () => {
    open();

    expect(text()).toContain('définitive');
    expect(text()).toContain('plus être modifié');
    expect(text()).toContain('aucun nouveau candidat');
    expect(text()).toContain("pas d'action de réouverture");
    expect(text()).toContain('Développeur Angular');
  });

  it('POSTs to the close action, never a status assignment (D-037)', () => {
    open();

    buttonLabelled('Confirmer la clôture').click();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBeTrue();
    // No `status` field anywhere: the update route refuses « Clôturé » as a
    // value, and this is the action that owns the transition.
    expect(req.request.body).toEqual({});

    req.flush({ id: ID, status: 'Clôturé' });
  });

  it('emits the closed position', () => {
    const emitted: JobPosition[] = [];
    open();
    fixture.componentInstance.closed.subscribe((p) => emitted.push(p));

    buttonLabelled('Confirmer la clôture').click();
    http.expectOne(URL).flush({ id: ID, status: 'Clôturé' });

    expect(emitted.length).toBe(1);
    expect(emitted[0].status).toBe('Clôturé');
  });

  it('POSITION_ALREADY_CLOSED is REPORTED, not swallowed as a success', () => {
    const emitted: JobPosition[] = [];
    open();
    fixture.componentInstance.closed.subscribe((p) => emitted.push(p));

    buttonLabelled('Confirmer la clôture').click();
    http.expectOne(URL).flush(
      { error: { code: 'POSITION_ALREADY_CLOSED', message: 'Ce poste est déjà clôturé.' } },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    // The server deliberately refuses rather than answering idempotently, so a
    // silent success here would misreport what happened.
    expect(text()).toContain('déjà clôturé');
    expect(emitted.length).toBe(0);
    expect(fixture.nativeElement.querySelector('.modal')).toBeTruthy();
  });

  it('D-038: a 403 is shown, not swallowed', () => {
    open();

    buttonLabelled('Confirmer la clôture').click();
    http.expectOne(URL).flush(
      {
        error: {
          code: 'FORBIDDEN',
          message: "Votre rôle ne vous autorise pas à accéder à cette ressource.",
        },
      },
      { status: 403, statusText: 'Forbidden' },
    );
    fixture.detectChanges();

    expect(text()).toContain('Votre rôle ne vous autorise pas');
  });

  it('reports an unreachable server rather than appearing to have worked', () => {
    open();

    buttonLabelled('Confirmer la clôture').click();
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
    fixture.detectChanges();

    expect(text()).toContain('Le serveur est injoignable.');
  });

  it('dismisses without touching the server', () => {
    const dismissed: number[] = [];
    open();
    fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

    buttonLabelled('Retour').click();

    expect(dismissed.length).toBe(1);
    expect(http.match(() => true).length).toBe(0);
  });
});

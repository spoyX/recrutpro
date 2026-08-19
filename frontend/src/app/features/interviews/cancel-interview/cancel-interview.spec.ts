import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CancelInterview } from './cancel-interview';
import { environment } from '../../../../environments/environment';

/**
 * FR-34 — the mandatory cancellation motive.
 *
 * These assertions MOVED here from `interviews-list.spec.ts` when the dialog
 * was extracted (D-106). Not rewritten: the behaviour is unchanged, only its
 * home. The interview list keeps the tests about what it OFFERS and what it
 * does afterwards; the rule itself is tested where the rule now lives, once,
 * for both the list and the candidate file that share it.
 */
describe('CancelInterview (FR-34)', () => {
  let fixture: ComponentFixture<CancelInterview>;
  let http: HttpTestingController;

  const ID = 'a';
  const URL = `${environment.apiUrl}/interviews/${ID}/cancel`;

  const open = (): void => {
    fixture = TestBed.createComponent(CancelInterview);
    fixture.componentRef.setInput('interviewId', ID);
    fixture.componentRef.setInput('candidateName', 'Jean Martin');
    fixture.componentRef.setInput('scheduledAt', '2026-08-25T12:00:00.000Z');
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CancelInterview],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('refuses a blank motive without calling the server', () => {
    open();
    fixture.componentInstance.reason.set('   ');

    fixture.componentInstance.confirm();

    expect(fixture.componentInstance.errorMessage()).toContain('motif');
    // http.verify() in afterEach proves no request was made.
  });

  it('posts the TRIMMED motive with credentials', () => {
    open();
    fixture.componentInstance.reason.set('  Candidat indisponible.  ');
    fixture.componentInstance.confirm();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.body).toEqual({ cancellationReason: 'Candidat indisponible.' });
    req.flush({});
  });

  it('emits `cancelled` so the HOST re-reads rather than patching a row', () => {
    open();
    const emitted: number[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push(1));

    fixture.componentInstance.reason.set('Motif');
    fixture.componentInstance.confirm();
    http.expectOne(URL).flush({});

    // Cancelling also reverts the candidate's stage, so what the row and the
    // file now look like is the server's to state, not this component's.
    expect(emitted.length).toBe(1);
  });

  it("NFR-09: surfaces the server's own refusal and stays open", () => {
    open();
    const emitted: number[] = [];
    fixture.componentInstance.cancelled.subscribe(() => emitted.push(1));

    fixture.componentInstance.reason.set('Motif');
    fixture.componentInstance.confirm();
    http.expectOne(URL).flush(
      {
        error: {
          code: 'INVALID_STAGE_TRANSITION',
          message: "Ce candidat a déjà dépassé l'étape « Entretien planifié ».",
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.errorMessage()).toContain('déjà dépassé');
    // Not dismissed: the reader has to see why, and may still reject instead.
    expect(emitted.length).toBe(0);
    expect(fixture.componentInstance.busy()).toBeFalse();
  });

  it('will not submit an empty motive through the button either', () => {
    open();

    expect(fixture.componentInstance.canSubmit()).toBeFalse();
    fixture.componentInstance.reason.set('Motif');
    expect(fixture.componentInstance.canSubmit()).toBeTrue();
  });
});

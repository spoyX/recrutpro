import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient, HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ScheduleInterview } from './schedule-interview';
import { environment } from '../../../../environments/environment';

/**
 * FR-30 / FR-31 / FR-32 — the scheduling dialog, and D-073's picker.
 *
 * The point of most of these is the BOUNDARY, not the happy path: that the
 * picker can only ask for responsables, that a conflict is a warning rather
 * than a failure, and that an override cannot survive a change to what is
 * being booked.
 */
describe('ScheduleInterview (FR-30 to FR-32, D-073)', () => {
  let fixture: ComponentFixture<ScheduleInterview>;
  let http: HttpTestingController;

  const CANDIDATE_ID = '64b7f0c2e1a2b3c4d5e6f7a8';
  const POSITION_ID = '64b7f0c2e1a2b3c4d5e6f7b0';
  const DEPT_ID = '64b7f0c2e1a2b3c4d5e6f7c0';

  const USERS_URL = `${environment.apiUrl}/users`;
  const POSITION_URL = `${environment.apiUrl}/job-positions/${POSITION_ID}`;
  const INTERVIEWS_URL = `${environment.apiUrl}/interviews`;

  const responsables = [
    { id: 'r1', name: 'Claire Morel', departmentId: DEPT_ID },
    { id: 'r2', name: 'Alain Petit', departmentId: DEPT_ID },
  ];

  /** Creates the dialog and settles both picker requests. */
  const open = (jobPositionId: string | null = POSITION_ID): void => {
    fixture = TestBed.createComponent(ScheduleInterview);
    fixture.componentRef.setInput('candidateId', CANDIDATE_ID);
    fixture.componentRef.setInput('candidateName', 'Jean Martin');
    fixture.componentRef.setInput('jobPositionId', jobPositionId);
    fixture.detectChanges();

    if (jobPositionId) {
      http.expectOne(POSITION_URL).flush({
        id: POSITION_ID,
        title: 'Développeur backend',
        departmentId: DEPT_ID,
        description: '',
        requirements: null,
        status: 'Ouvert',
        createdAt: '2026-08-01T09:00:00.000Z',
      });
    }
    http.expectOne((r: HttpRequest<unknown>) => r.url === USERS_URL).flush(responsables);
    fixture.detectChanges();
  };

  /** Fills both fields the way the template does, through the component API. */
  const fill = (interviewerId: string, localSlot: string): void => {
    fixture.componentInstance.setInterviewer(interviewerId);
    fixture.componentInstance.setSlot(localSlot);
    fixture.detectChanges();
  };

  /**
   * A local wall-clock string in the `datetime-local` format, N days ahead.
   * Built from LOCAL parts on purpose: the whole point of the conversion test
   * is that the component reads it as local, so hard-coding a UTC literal here
   * would pass in one timezone and fail in another.
   */
  const futureLocal = (days = 7): { local: string; instant: Date } => {
    const at = new Date();
    at.setDate(at.getDate() + days);
    at.setHours(14, 30, 0, 0);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return {
      local:
        `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
        `T${pad(at.getHours())}:${pad(at.getMinutes())}`,
      instant: at,
    };
  };

  const text = (): string => fixture.nativeElement.textContent as string;

  const buttonLabelled = (label: string): HTMLButtonElement =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleInterview],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('D-073 — the picker asks for responsables, and only responsables', () => {
    it('sends role=ResponsableHierarchique and the department of the poste', () => {
      fixture = TestBed.createComponent(ScheduleInterview);
      fixture.componentRef.setInput('candidateId', CANDIDATE_ID);
      fixture.componentRef.setInput('candidateName', 'Jean Martin');
      fixture.componentRef.setInput('jobPositionId', POSITION_ID);
      fixture.detectChanges();

      // Two hops: the candidate file carries the poste's id, not its department.
      const position = http.expectOne(POSITION_URL);
      expect(position.request.withCredentials).toBeTrue();
      position.flush({ id: POSITION_ID, title: 'X', departmentId: DEPT_ID, status: 'Ouvert' });

      const users = http.expectOne((r: HttpRequest<unknown>) => r.url === USERS_URL);
      expect(users.request.params.get('role')).toBe('ResponsableHierarchique');
      expect(users.request.params.get('departmentId')).toBe(DEPT_ID);
      expect(users.request.withCredentials).toBeTrue();
      users.flush(responsables);
    });

    it('renders one option per responsable, plus the empty prompt', () => {
      open();

      const options = fixture.nativeElement.querySelectorAll('#schedule-interviewer option');
      expect(options.length).toBe(3);
      expect((options[1] as HTMLOptionElement).value).toBe('r1');
      expect((options[1] as HTMLOptionElement).textContent).toContain('Claire Morel');
    });

    it('with no poste, asks for every responsable and skips the position lookup', () => {
      fixture = TestBed.createComponent(ScheduleInterview);
      fixture.componentRef.setInput('candidateId', CANDIDATE_ID);
      fixture.componentRef.setInput('candidateName', 'Jean Martin');
      fixture.componentRef.setInput('jobPositionId', null);
      fixture.detectChanges();

      const users = http.expectOne((r: HttpRequest<unknown>) => r.url === USERS_URL);
      // Still narrowed by ROLE — that half is never optional (D-073 would 403).
      expect(users.request.params.get('role')).toBe('ResponsableHierarchique');
      expect(users.request.params.has('departmentId')).toBeFalse();
      users.flush(responsables);

      // And no /job-positions call was made at all.
      http.verify();
    });

    it('says so plainly when the department has no active responsable', () => {
      open();
      http.verify();

      fixture = TestBed.createComponent(ScheduleInterview);
      fixture.componentRef.setInput('candidateId', CANDIDATE_ID);
      fixture.componentRef.setInput('candidateName', 'Jean Martin');
      fixture.componentRef.setInput('jobPositionId', null);
      fixture.detectChanges();
      http.expectOne((r: HttpRequest<unknown>) => r.url === USERS_URL).flush([]);
      fixture.detectChanges();

      expect(text()).toContain('Aucun responsable hiérarchique actif');
      expect(buttonLabelled('Planifier').disabled).toBeTrue();
    });
  });

  describe('FR-30 — the request', () => {
    it('cannot be submitted until BOTH the responsable and the slot are chosen', () => {
      open();

      expect(buttonLabelled('Planifier').disabled).toBeTrue();

      fixture.componentInstance.setInterviewer('r1');
      fixture.detectChanges();
      expect(buttonLabelled('Planifier').disabled).toBeTrue();

      fixture.componentInstance.setSlot(futureLocal().local);
      fixture.detectChanges();
      expect(buttonLabelled('Planifier').disabled).toBeFalse();
    });

    it('sends the LOCAL wall-clock time as the instant it actually names', () => {
      const { local, instant } = futureLocal();
      open();
      fill('r1', local);

      buttonLabelled('Planifier').click();

      const req = http.expectOne(INTERVIEWS_URL);
      const body = req.request.body as Record<string, unknown>;
      expect(req.request.method).toBe('POST');
      expect(req.request.withCredentials).toBeTrue();
      expect(body['candidateId']).toBe(CANDIDATE_ID);
      expect(body['interviewerId']).toBe('r1');
      // Compared as INSTANTS, not as strings: `datetime-local` has no zone, and
      // a string comparison would only pass in whichever timezone wrote it.
      expect(new Date(body['scheduledAt'] as string).getTime()).toBe(instant.getTime());
      // FR-32's override is absent on a first attempt — never sent by default.
      expect(body['confirmDespiteConflict']).toBeUndefined();

      req.flush({ id: 'i9' });
    });

    it('emits `scheduled` once the interview exists, so the caller can reload', () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.scheduled.subscribe(() => emitted.push(1));
      fill('r1', futureLocal().local);

      buttonLabelled('Planifier').click();
      http.expectOne(INTERVIEWS_URL).flush({ id: 'i9' });

      expect(emitted.length).toBe(1);
    });
  });

  describe('FR-31 / FR-32 — a conflict is a warning, not a refusal', () => {
    const conflict = () => ({
      error: {
        code: 'SCHEDULING_CONFLICT',
        message: 'Ce responsable a déjà un entretien proche de ce créneau : Sophie Bernard.',
      },
    });

    const provokeConflict = (): void => {
      buttonLabelled('Planifier').click();
      http
        .expectOne(INTERVIEWS_URL)
        .flush(conflict(), { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
    };

    it("shows the server's own conflict message, and does NOT report success", () => {
      const emitted: number[] = [];
      open();
      fixture.componentInstance.scheduled.subscribe(() => emitted.push(1));
      fill('r1', futureLocal().local);

      provokeConflict();

      expect(text()).toContain('Sophie Bernard');
      expect(emitted.length).toBe(0);
      // The warning does not wear the error styling: FR-32 lets this proceed.
      expect(fixture.nativeElement.querySelector('.modal__warning')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeNull();
    });

    it('offers the override, which re-sends with confirmDespiteConflict', () => {
      open();
      fill('r1', futureLocal().local);
      provokeConflict();

      buttonLabelled('Planifier malgré le conflit').click();

      const retry = http.expectOne(INTERVIEWS_URL);
      expect((retry.request.body as Record<string, unknown>)['confirmDespiteConflict']).toBeTrue();
      retry.flush({ id: 'i9' });
    });

    it('CHANGING THE SLOT drops the pending override — the warning was about the old one', () => {
      open();
      fill('r1', futureLocal(7).local);
      provokeConflict();
      expect(buttonLabelled('Planifier malgré le conflit')).toBeTruthy();

      // A different slot has not been checked for conflicts at all, so sending
      // the override would silently suppress FR-31 on a booking nobody warned
      // about.
      fixture.componentInstance.setSlot(futureLocal(9).local);
      fixture.detectChanges();

      expect(buttonLabelled('Planifier malgré le conflit')).toBeUndefined();
      buttonLabelled('Planifier').click();

      const req = http.expectOne(INTERVIEWS_URL);
      expect(
        (req.request.body as Record<string, unknown>)['confirmDespiteConflict'],
      ).toBeUndefined();
      req.flush({ id: 'i9' });
    });

    it('changing the RESPONSABLE drops it too — the conflict was theirs', () => {
      open();
      fill('r1', futureLocal().local);
      provokeConflict();

      fixture.componentInstance.setInterviewer('r2');
      fixture.detectChanges();

      buttonLabelled('Planifier').click();
      const req = http.expectOne(INTERVIEWS_URL);
      expect(
        (req.request.body as Record<string, unknown>)['confirmDespiteConflict'],
      ).toBeUndefined();
      req.flush({ id: 'i9' });
    });
  });

  describe('Errors that are real failures', () => {
    it('D-043: shows the server message when the slot is in the past', () => {
      open();
      fill('r1', futureLocal().local);

      buttonLabelled('Planifier').click();
      http.expectOne(INTERVIEWS_URL).flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: "La date de l'entretien doit être dans le futur. Corrigez la date et l'heure.",
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain("doit être dans le futur");
      expect(fixture.nativeElement.querySelector('.modal__error')).toBeTruthy();
      // Not offered as an overridable conflict — this one cannot be forced.
      expect(buttonLabelled('Planifier malgré le conflit')).toBeUndefined();
    });

    it('FR-30: shows the server message when the responsable is not eligible', () => {
      open();
      fill('r1', futureLocal().local);

      buttonLabelled('Planifier').click();
      http.expectOne(INTERVIEWS_URL).flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: "L'intervenant choisi doit être un responsable hiérarchique actif du département du poste.",
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('responsable hiérarchique actif du département du poste');
    });

    it('reports an unreachable server rather than a silent no-op', () => {
      open();
      fill('r1', futureLocal().local);

      buttonLabelled('Planifier').click();
      http
        .expectOne(INTERVIEWS_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: '' });
      fixture.detectChanges();

      expect(text()).toContain('Le serveur est injoignable.');
    });

    it('surfaces a picker failure instead of an empty dropdown that looks normal', () => {
      fixture = TestBed.createComponent(ScheduleInterview);
      fixture.componentRef.setInput('candidateId', CANDIDATE_ID);
      fixture.componentRef.setInput('candidateName', 'Jean Martin');
      fixture.componentRef.setInput('jobPositionId', null);
      fixture.detectChanges();

      http
        .expectOne((r: HttpRequest<unknown>) => r.url === USERS_URL)
        .flush(
          { error: { code: 'FORBIDDEN', message: "L'annuaire des comptes est réservé à l'administration." } },
          { status: 403, statusText: 'Forbidden' },
        );
      fixture.detectChanges();

      expect(text()).toContain("réservé à l'administration");
    });
  });

  it('D-043: the native picker floor is a LOCAL wall-clock string, not a UTC instant', () => {
    open();

    const input = fixture.nativeElement.querySelector('#schedule-at') as HTMLInputElement;
    const min = input.getAttribute('min')!;
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Read back as local, it must be ~now. A `toISOString()` slip would land
    // it a whole timezone offset away, which this catches everywhere but UTC.
    expect(Math.abs(new Date(min).getTime() - Date.now())).toBeLessThan(120_000);
  });

  it('dismisses without touching the server', () => {
    const dismissed: number[] = [];
    open();
    fixture.componentInstance.dismissed.subscribe(() => dismissed.push(1));

    buttonLabelled('Retour').click();

    expect(dismissed.length).toBe(1);
    http.verify();
  });
});

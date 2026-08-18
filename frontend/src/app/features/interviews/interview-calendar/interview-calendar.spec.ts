import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { InterviewCalendar } from './interview-calendar';
import { InterviewListItem, InterviewListQuery } from '../interview.service';
import { environment } from '../../../../environments/environment';

const URL = `${environment.apiUrl}/interviews`;

const row = (id: string, at: string, status = 'Planifié'): InterviewListItem =>
  ({
    id,
    scheduledAt: at,
    status,
    candidate: { id: 'c' + id, fullName: 'Candidat ' + id, hasResume: false, resumeUrl: `/api/v1/candidates/c${id}/resume` },
    jobPosition: { id: 'p1', title: 'Développeur backend' },
    interviewer: { id: 'r1', name: 'Claire Fontaine', avatarUrl: null },
    cancellationReason: status === 'Annulé' ? 'Indisponible' : null,
  }) as InterviewListItem;

@Component({
  imports: [InterviewCalendar],
  template: `<app-interview-calendar
    [filters]="filters()"
    [includeFinished]="includeFinished()"
    (opened)="opened.set($event)"
  />`,
})
class Host {
  readonly filters = signal<InterviewListQuery>({});
  readonly includeFinished = signal(false);
  readonly opened = signal<InterviewListItem | null>(null);
}

describe('InterviewCalendar — D-094 / D-096', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  const text = (): string => fixture.nativeElement.textContent ?? '';

  /** FullCalendar fires `datesSet` on render, which triggers the first fetch. */
  const pending = (): TestRequest[] => http.match((r) => r.url === URL);

  const create = (): void => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((r) => r.flush([], { headers: { 'X-Total-Count': '0' } }));
    http.verify();
  });

  it('renders a calendar and asks for its VISIBLE window, not everything', () => {
    create();

    const reqs = pending();
    expect(reqs.length).toBe(1);
    const params = reqs[0].request.params;
    // fromDate/toDate bound the query to what is on screen.
    expect(params.get('fromDate')).toBeTruthy();
    expect(params.get('toDate')).toBeTruthy();
    expect(new Date(params.get('fromDate')!).getTime()).toBeLessThan(
      new Date(params.get('toDate')!).getTime(),
    );
    reqs[0].flush([], { headers: { 'X-Total-Count': '0' } });
  });

  describe('D-045: the OPEN schedule by default', () => {
    it('does NOT send includeFinished unless asked', () => {
      create();

      const req = pending()[0];
      expect(req.request.params.has('includeFinished')).toBeFalse();
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });

    it('sends it when the shared toggle is on — the calendar never forces it', () => {
      fixture = TestBed.createComponent(Host);
      fixture.componentInstance.includeFinished.set(true);
      fixture.detectChanges();

      const req = pending()[0];
      expect(req.request.params.get('includeFinished')).toBe('true');
      req.flush([], { headers: { 'X-Total-Count': '0' } });
    });
  });

  describe('the derived duration (D-005 / D-094)', () => {
    it('draws each interview as a 30-minute block from its start', () => {
      create();
      pending()[0].flush([row('a', '2026-08-19T09:00:00.000Z')], {
        headers: { 'X-Total-Count': '1' },
      });
      fixture.detectChanges();

      const events = fixture.componentInstance as unknown as Host;
      expect(events).toBeTruthy();
      const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
        .componentInstance as InterviewCalendar;
      const ev = cal.events()[0];
      const start = new Date(ev['start'] as Date).getTime();
      const end = new Date(ev['end'] as Date).getTime();
      // Exactly D-005's conflict window — the block a reader sees is the span
      // the server refuses to double-book.
      expect(end - start).toBe(30 * 60 * 1000);
    });

    it('carries the status into a class so cancelled reads as history', () => {
      create();
      pending()[0].flush(
        [row('a', '2026-08-19T09:00:00.000Z', 'Annulé'), row('b', '2026-08-19T11:00:00.000Z')],
        { headers: { 'X-Total-Count': '2' } },
      );
      fixture.detectChanges();

      const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
        .componentInstance as InterviewCalendar;
      const classes = cal.events().map((e) => (e['classNames'] as string[])[0]);
      expect(classes).toContain('iv--cancelled');
      expect(classes).toContain('iv--planned');
    });
  });

  describe('MAX_INTERVIEW_LIMIT = 100', () => {
    it('pages through a window that holds more than one request can carry', () => {
      create();

      const first = pending()[0];
      expect(first.request.params.get('limit')).toBe('100');
      expect(first.request.params.get('offset')).toBe('0');
      first.flush(
        Array.from({ length: 100 }, (_, i) => row('a' + i, '2026-08-19T09:00:00.000Z')),
        { headers: { 'X-Total-Count': '150' } },
      );
      fixture.detectChanges();

      // It asks for the remainder rather than drawing 100 of 150 silently.
      const second = pending()[0];
      expect(second.request.params.get('offset')).toBe('100');
      second.flush(
        Array.from({ length: 50 }, (_, i) => row('b' + i, '2026-08-20T09:00:00.000Z')),
        { headers: { 'X-Total-Count': '150' } },
      );
      fixture.detectChanges();

      const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
        .componentInstance as InterviewCalendar;
      expect(cal.rows().length).toBe(150);
      expect(cal.truncatedAt()).toBeNull();
      expect(text()).not.toContain('seuls les');
    });

    it('SAYS SO when it stops early, rather than showing a partial month as complete', () => {
      create();

      // Ten full pages, with the server still reporting more.
      for (let page = 0; page < 10; page += 1) {
        const req = pending()[0];
        req.flush(
          Array.from({ length: 100 }, (_, i) => row(`p${page}-${i}`, '2026-08-19T09:00:00.000Z')),
          { headers: { 'X-Total-Count': '5000' } },
        );
        fixture.detectChanges();
      }

      const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
        .componentInstance as InterviewCalendar;
      expect(cal.truncatedAt()).toBe(1000);
      expect(text()).toContain('5000');
      expect(text()).toContain('1000');
      // The wording must not imply completeness.
      expect(text()).toContain('seuls les');
    });
  });

  describe('there is NO drag-to-reschedule (D-066)', () => {
    it('the calendar is not editable and not selectable', () => {
      create();
      pending()[0].flush([], { headers: { 'X-Total-Count': '0' } });

      const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
        .componentInstance as InterviewCalendar;
      // PATCH /interviews/:id was struck from the contract, so there is nowhere
      // to persist a moved block. A drag that snaps back would be a lie.
      expect(cal.options().editable).toBeFalse();
      expect(cal.options().selectable).toBeFalse();
    });

    it('says in the interface why blocks do not move', () => {
      create();
      pending()[0].flush([], { headers: { 'X-Total-Count': '0' } });
      fixture.detectChanges();

      expect(text()).toContain('glisser-déposer');
      expect(text()).toContain('annuler avec un motif');
    });
  });

  it('emits the row when an interview is opened, so the parent reuses its own actions', () => {
    create();
    const one = row('a', '2026-08-19T09:00:00.000Z');
    pending()[0].flush([one], { headers: { 'X-Total-Count': '1' } });
    fixture.detectChanges();

    const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
      .componentInstance as InterviewCalendar;
    const click = cal.options().eventClick!;
    click({ event: { extendedProps: { row: one } } } as never);

    expect(fixture.componentInstance.opened()?.id).toBe('a');
  });

  it('shows the server message on failure and draws nothing', () => {
    create();
    pending()[0].flush(
      { error: { code: 'VALIDATION_ERROR', message: '« fromDate » doit précéder « toDate ».' } },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    expect(text()).toContain('« fromDate » doit précéder « toDate ».');
    const cal = fixture.debugElement.query((n) => n.name === 'app-interview-calendar')
      .componentInstance as InterviewCalendar;
    expect(cal.rows()).toEqual([]);
  });
});

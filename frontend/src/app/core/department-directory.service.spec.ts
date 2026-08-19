import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DepartmentDirectory } from './department-directory.service';
import { environment } from '../../environments/environment';

describe('DepartmentDirectory', () => {
  const URL = `${environment.apiUrl}/departments`;
  const ROWS = [
    { id: 'd1', name: 'Ingénierie', isActive: true },
    { id: 'd2', name: 'Ventes', isActive: false },
  ];

  let directory: DepartmentDirectory;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    directory = TestBed.inject(DepartmentDirectory);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('D-001: requests with credentials, and asks for inactive ones too', () => {
    directory.list().subscribe();

    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.withCredentials).toBeTrue();
    // A user or position attached to a since-deactivated department must still
    // be nameable — this is not a choice list.
    expect(req.request.params.get('includeInactive')).toBe('true');
    req.flush(ROWS);
  });

  it('fetches ONCE however many callers ask — the topbar and the filter share it', () => {
    const seen: number[] = [];
    directory.list().subscribe((rows) => seen.push(rows.length));
    directory.list().subscribe((rows) => seen.push(rows.length));

    http.expectOne((r) => r.url === URL).flush(ROWS);

    // One request, both callers served.
    expect(seen).toEqual([2, 2]);

    // A later caller is served from the cache with no request at all.
    directory.list().subscribe((rows) => seen.push(rows.length));
    expect(seen).toEqual([2, 2, 2]);
  });

  it('resolves an id to a name, and reports null for one it does not hold', () => {
    let names: ReadonlyMap<string, string> | undefined;
    directory.names().subscribe((n) => (names = n));
    http.expectOne((r) => r.url === URL).flush(ROWS);

    expect(names!.get('d1')).toBe('Ingénierie');
    expect(names!.get('d2')).toBe('Ventes');
    expect(names!.get('missing')).toBeUndefined();
  });

  it('propagates the failure rather than swallowing it — callers degrade differently', () => {
    let failed = false;
    directory.list().subscribe({ error: () => (failed = true) });

    http.expectOne((r) => r.url === URL).flush(null, { status: 500, statusText: 'Server Error' });

    expect(failed).toBeTrue();
  });

  it('drops the cache on failure, so the next caller retries', () => {
    directory.list().subscribe({ error: () => undefined });
    http.expectOne((r) => r.url === URL).flush(null, { status: 500, statusText: 'Server Error' });

    // Caching the failure would hide the department for the whole session.
    let rows: unknown[] | undefined;
    directory.list().subscribe((r) => (rows = r));
    http.expectOne((r) => r.url === URL).flush(ROWS);

    expect(rows!.length).toBe(2);
  });

  it('treats a null body as an empty list rather than throwing', () => {
    let rows: unknown[] | undefined;
    directory.list().subscribe((r) => (rows = r));
    http.expectOne((r) => r.url === URL).flush(null);

    expect(rows).toEqual([]);
  });
});

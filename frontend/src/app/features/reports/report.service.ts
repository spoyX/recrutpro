import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * SRS Section 1.5 — « Rapports : pipeline par poste et délai moyen de
 * recrutement », user stories 22 and 23.
 *
 * Mirrors `views/report.view.ts`. Both shapes carry a field that exists to stop
 * the reader drawing a wrong conclusion, and neither may be dropped here:
 * `jobPosition.status`, because a pipeline of zero on a CLÔTURÉ posting means
 * something different from the same zero on an open one; and `hires`, because
 * an average over two hires is not a statistic.
 */
export interface PipelineRow {
  jobPosition: { id: string; title: string; status: string };
  /** Every one of the seven stages, always — including those at zero (D-057). */
  stages: Record<string, number>;
  total: number;
}

export interface TimeToHire {
  fromDate: string | null;
  toDate: string | null;
  /** The sample size the averages rest on. */
  hires: number;
  /** Null, never 0, when there are no hires — zero days would be a false claim. */
  averageDays: number | null;
  fastestDays: number | null;
  slowestDays: number | null;
  /**
   * D-110 — the same sample grouped by month, zero-filled across the window
   * and bounded server-side. Oldest first, so a trend reads left to right.
   */
  byMonth: TimeToHireMonth[];
}

export interface TimeToHireMonth {
  /** `YYYY-MM`, cut in Europe/Paris by the server. */
  month: string;
  hires: number;
  /**
   * Null, NEVER 0, for a month with no hires. Zero days would claim those
   * nobodies were hired instantly; the chart draws a gap instead of a dip.
   */
  averageDays: number | null;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly http = inject(HttpClient);

  /**
   * User story 22. Without `jobPositionId` every position the CALLER may see,
   * one row each; with it, exactly that one.
   *
   * The scope is the server's: a Responsable hiérarchique sees only their own
   * department (rule 2, D-047) and this sends nothing to say so — asking for a
   * scope from the client is what NFR-04 forbids.
   */
  pipeline(jobPositionId?: string): Observable<PipelineRow[]> {
    let params = new HttpParams();
    if (jobPositionId) {
      params = params.set('jobPositionId', jobPositionId);
    }

    return this.http
      .get<PipelineRow[]>(`${environment.apiUrl}/reports/pipeline`, {
        params,
        // Session auth (D-001): the cookie is the credential.
        withCredentials: true,
      })
      .pipe(map((rows) => rows ?? []));
  }

  /**
   * User story 23. The period filters on `decidedAt`, not `registeredAt` — the
   * report is about hires CONCLUDED in the window, and the server is explicit
   * that filtering the other way would bias the average downward by excluding
   * slow hires still in flight.
   */
  timeToHire(fromDate?: string, toDate?: string): Observable<TimeToHire> {
    let params = new HttpParams();
    // Only ever sent when set: an empty `fromDate=` is an invalid date rather
    // than the absence of one, and the server answers it with a 400.
    if (fromDate) {
      params = params.set('fromDate', fromDate);
    }
    if (toDate) {
      params = params.set('toDate', toDate);
    }

    return this.http.get<TimeToHire>(`${environment.apiUrl}/reports/time-to-hire`, {
      params,
      withCredentials: true,
    });
  }
}

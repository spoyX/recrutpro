import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';

/**
 * Drain the requests the SHELL makes, so a page's spec can verify its own.
 *
 * Since D-081 the topbar carries the unread-notification badge, which asks for
 * `GET /notifications?isRead=false&limit=1` every time `<app-shell>` renders.
 * That is deliberate — each page renders its own shell, so the count refreshes
 * on every navigation — but it means every page spec now sees one request it
 * did not make, and `http.verify()` fails on it.
 *
 * Call this in `afterEach` BEFORE `http.verify()`. It is deliberately narrow:
 * it matches the notifications URL only, so a page's own stray request still
 * fails the spec exactly as it did before.
 *
 * Returns how many it drained, so a spec that wants to assert the badge fired
 * can, rather than merely tolerating it.
 */
export const drainShellRequests = (http: HttpTestingController): number =>
  http.match((request) => request.url === `${environment.apiUrl}/notifications`).length;

/**
 * "The page issued no further request" — the assertion `http.verify()` used to
 * stand in for, now that the shell legitimately makes one of its own.
 *
 * Two improvements over the bare `verify()` it replaces, both learned the hard
 * way this week. It ignores the SHELL's badge request and nothing else, so a
 * page's own stray call still fails. And it is a real Jasmine expectation on a
 * list of what was found — `verify()` records none, which Karma reports as a
 * spec that asserts nothing and which would silently pass if the line were
 * ever deleted. On failure it names the offending method and URL.
 */
export const expectNoPageRequests = (http: HttpTestingController): void => {
  const stray = http
    .match((request) => request.url !== `${environment.apiUrl}/notifications`)
    .map((request) => `${request.request.method} ${request.request.urlWithParams}`);

  expect(stray).toEqual([]);
};

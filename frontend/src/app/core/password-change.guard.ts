import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * FR-10 — « l'utilisateur est contraint de le changer à la prochaine
 * connexion. »
 *
 * *** WHY A ROUTING GATE IS REQUIRED AND NOT MERELY NICER. *** `requireAuth`
 * refuses EVERY protected route with a 403 while `mustChangePassword` is set —
 * only `/auth/change-password` and `/auth/logout` are reachable. So a flagged
 * user who lands anywhere else does not see a degraded page; they see an error
 * on every page with no way out. Backend enforcement alone produces a dead
 * end, which is not "forced to change it" but "cannot use the application".
 * The constraint FR-10 describes has to exist on the client too, and it has to
 * exist as a REDIRECT rather than a message.
 *
 * *** THIS GUARD IS ONLY POSSIBLE BECAUSE OF D-070. *** D-064 deliberately
 * wrote no guard, and its reason was concrete: `currentUser` was populated only
 * by `login()`, so after a refresh it was null even with a valid session, and a
 * guard would have bounced a signed-in user to the login page every time.
 * D-070 made `restoreSession()` an app initializer, so the signal is populated
 * before the first render and a guard can finally read something true.
 *
 * It is an AFFORDANCE, not authorisation (NFR-04): the server refuses these
 * routes regardless. What this adds is the exit.
 *
 * An unknown user is deliberately let through: they are not flagged, and the
 * page's own 401 handling sends them to /login. Guessing here would fight that.
 */
export const passwordChangeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.currentUser()?.mustChangePassword) {
    return router.createUrlTree(['/change-password']);
  }

  return true;
};

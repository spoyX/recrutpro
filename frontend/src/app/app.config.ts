import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { AuthService } from './core/auth.service';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // `withComponentInputBinding` binds route params straight to component
    // `input()`s — how the Candidate Details page receives `:id` without
    // injecting ActivatedRoute and subscribing (the v20 idiom).
    provideRouter(routes, withComponentInputBinding()),
    // Session cookies (D-001) travel on the requests themselves; each call
    // opts in with `withCredentials`. No token interceptor exists because
    // there are no tokens.
    provideHttpClient(withFetch()),
    // D-070 (closes D-065): ask the server who we are BEFORE the first route
    // renders, so a refresh restores the identity the login response carried.
    // Placed here rather than in a component because every page needs it and
    // the shell must not flash a blank topbar while it resolves. It never
    // rejects — an anonymous 401 resolves to null (see restoreSession).
    provideAppInitializer(() => inject(AuthService).restoreSession()),
  ],
};

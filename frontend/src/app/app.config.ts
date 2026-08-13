import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
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
  ],
};

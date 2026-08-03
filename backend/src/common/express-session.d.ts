import 'express-session';
import { Role } from './constants';

// What the server stores in a session. Deliberately minimal: an id and a role,
// never the user document — role changes and deactivations must take effect on
// the next request, not persist in a stale copy inside the session.
declare module 'express-session' {
  interface SessionData {
    userId: string;
    role: Role;
  }
}

import session from 'express-session';
import MongoStore from 'connect-mongo';

/** FR-2: a session expires after 30 minutes of INACTIVITY, not 30 minutes absolute. */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';
const mongoUrl = process.env.MONGO_URI;

// D-001 / D-010: connect-mongo is the session store precisely because the
// default MemoryStore drops every session on restart. Falling back to it in
// production would silently reintroduce that, so that combination throws.
if (isProduction && !mongoUrl) {
  throw new Error('MONGO_URI is required in production: the session store cannot fall back to MemoryStore.');
}

const secret = process.env.SESSION_SECRET ?? (isProduction ? undefined : 'dev-insecure-secret');
if (!secret) {
  throw new Error('SESSION_SECRET is required. See backend/.env.example.');
}
if (secret === 'dev-only-change-me') {
  console.warn(
    '[session] SESSION_SECRET is still the placeholder from .env.example. Sessions are forgeable — replace it before any real deployment.',
  );
}

/**
 * Exported so tests and the entrypoint can close it; leaving it open keeps the
 * Mongo client alive and stops the process (or Jest) from exiting.
 * Undefined only when MONGO_URI is absent outside production — see above.
 */
export const sessionStore: session.Store = mongoUrl
  ? MongoStore.create({
      mongoUrl,
      collectionName: 'sessions',
      // TTL must match the cookie window, or the store would expire a record
      // while the browser still believes its cookie is valid (FR-2).
      ttl: SESSION_INACTIVITY_MS / 1000,
      // Refresh the stored expiry on every request. connect-mongo's default is
      // already 0; stated explicitly because a non-zero value here would break
      // the inactivity semantics FR-2 requires.
      touchAfter: 0,
    })
  : // Explicit rather than letting express-session pick its own default, so
    // tests can read back what a request actually stored.
    new session.MemoryStore();

if (!mongoUrl) {
  console.warn('[session] MONGO_URI not set — using in-memory sessions. Development only.');
}

/** MongoStore holds a Mongo client open; MemoryStore has nothing to close. */
export const closeSessionStore = async (): Promise<void> => {
  await (sessionStore as { close?: () => Promise<void> }).close?.();
};

/**
 * Exported so logout clears exactly the cookie the session middleware set.
 * Two literals would silently drift and leave a stale cookie behind (FR-4).
 */
export const SESSION_COOKIE_NAME = 'recrutpro.sid';

/** Cookie attributes shared by the session middleware and clearCookie (FR-4). */
/**
 * D-111 - `secure` is driven by the environment, NOT hardcoded either way.
 *
 * *** HARDCODING `true` BREAKS LOCAL DEVELOPMENT COMPLETELY, and silently. ***
 * A `Secure` cookie is only ever sent back over HTTPS. The local stack serves
 * plain HTTP through nginx on :4200, so the browser accepts the Set-Cookie,
 * declines to store it, and every subsequent request arrives anonymous - login
 * "succeeds" with a 200 and the next page bounces to /login. Measured, not
 * assumed: see D-111.
 *
 * So the gate is an env var. It defaults to ON under `NODE_ENV=production`,
 * which is the deployment case the checklist item exists for, and OFF
 * otherwise. `COOKIE_SECURE` overrides both, for a local HTTPS setup or to
 * prove the flag works.
 *
 * `app.set('trust proxy', 1)` is already in app.ts (D-025) and is required for
 * this: behind nginx, Express decides "is this connection secure?" from
 * `X-Forwarded-Proto`, and without trusting the proxy it would refuse to set a
 * secure cookie even over real TLS.
 */
const secureCookies = (): boolean => {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit !== undefined) {
    return explicit === 'true';
  }
  return process.env.NODE_ENV === 'production';
};

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: secureCookies(),
} as const;

export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret,
  store: sessionStore,
  // Nothing is written back unless the session actually changed.
  resave: false,
  // No session record (and no cookie) until something is stored in it — an
  // anonymous GET /health must not create a database row.
  saveUninitialized: false,
  // FR-2: re-issue the cookie on every response so the 30-minute window
  // measures inactivity. Without this, maxAge would be an absolute lifetime
  // and an actively working user would be logged out mid-task.
  rolling: true,
  cookie: {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_INACTIVITY_MS,
  },
});

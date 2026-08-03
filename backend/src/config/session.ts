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
export const sessionStore = mongoUrl
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
  : undefined;

if (!sessionStore) {
  console.warn('[session] MONGO_URI not set — using in-memory sessions. Development only.');
}

export const sessionMiddleware = session({
  name: 'recrutpro.sid',
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
    httpOnly: true,
    sameSite: 'lax',
    // Local dev runs over plain HTTP through nginx, so this stays false.
    // PRODUCTION GATE: must become true (and the app must trust the proxy)
    // before any TLS deployment, or the cookie travels in the clear.
    secure: false,
    maxAge: SESSION_INACTIVITY_MS,
  },
});

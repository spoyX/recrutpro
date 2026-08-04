import { rateLimit, MemoryStore } from 'express-rate-limit';
import { AppError } from '../common/errors';

/** D-025: 5 attempts per IP per 15 minutes on the login endpoint. */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX = 5;

/**
 * Exported so tests can reset the counter between cases. Without this, the
 * login tests would exhaust the budget against each other and start failing
 * for the wrong reason.
 *
 * ponytail: per-process memory store. Counters reset on restart and are not
 * shared across replicas — fine for the single backend container at the ~50
 * user scale of NFR-01. Move to a shared store if the API is ever scaled out.
 */
export const loginRateLimitStore = new MemoryStore();

export const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_RATE_LIMIT_MAX,
  store: loginRateLimitStore,
  // D-028: only FAILED attempts count. Counting successes too would make
  // colleagues behind one office NAT address share a five-login budget and
  // lock each other out of normal work (NFR-08). Brute force is unaffected —
  // an attacker's guesses are failures by definition.
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Default behaviour returns plain text, which would be the only response in
  // the API not matching the Section 9 {error:{code,message}} shape. Hand it to
  // the global error handler instead (D-020).
  handler: (_req, _res, next) => {
    next(
      new AppError(
        429,
        'TOO_MANY_REQUESTS',
        'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
      ),
    );
  },
});

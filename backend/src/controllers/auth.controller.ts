import { RequestHandler } from 'express';
import { authenticate, establishSession, terminateSession } from '../services/auth.service';
import { toPublicUser } from '../views/user.view';
import { AppError } from '../common/errors';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '../config/session';

/**
 * POST /api/v1/auth/login — FR-1.
 *
 * HTTP concerns only (ARCHITECTURE.md Section 2): read the body, check its
 * shape, delegate, shape the response. Every credential rule lives in
 * auth.service.ts.
 */
export const login: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;

    // Request-shape validation, not a business rule. A malformed body is a 400
    // and says so (NFR-09); it reveals nothing about which accounts exist,
    // because it never got as far as looking one up.
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Les champs « email » et « mot de passe » sont requis.',
      );
    }

    const user = await authenticate(email, password);
    // Pass the request, not req.session: regenerate() swaps the session object
    // out, so the service must be able to re-read the current one.
    await establishSession(req, user);

    res.status(200).json(toPublicUser(user));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/logout — FR-4.
 *
 * Deliberately idempotent: logging out without a session succeeds rather than
 * returning 401. The desired end state (no session) is already true, and an
 * error would only strand a user whose session had just expired on a page they
 * cannot leave cleanly.
 */
export const logout: RequestHandler = async (req, res, next) => {
  try {
    await terminateSession(req);

    // Must match the attributes the cookie was set with, or the browser keeps
    // the original — hence the shared constants rather than a second literal.
    res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

import { compare, hashSync } from 'bcryptjs';
import type { Session, SessionData } from 'express-session';
import { User, IUser } from '../models/User.model';
import { AppError } from '../common/errors';

/**
 * FR-3: ONE message for every authentication failure — unknown email, wrong
 * password, or deactivated account alike. Never say which. Distinguishing them
 * hands an attacker a list of valid company email addresses.
 */
const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');

/**
 * Compared against when no user matches, so a nonexistent account costs the
 * same time as a wrong password. Without it, bcrypt's own cost makes the two
 * cases trivially distinguishable by response time and FR-3 leaks anyway.
 */
const DUMMY_HASH = hashSync('__no_such_user__', 10);

/**
 * FR-1/FR-2: verify credentials. Returns the user on success, throws the one
 * generic error on every failure.
 */
export const authenticate = async (email: unknown, password: unknown): Promise<IUser> => {
  // NFR-05, and an auth bypass guard. A non-string email is not merely invalid:
  // `{ $ne: null }` would make findOne match an arbitrary user, and `undefined`
  // is stripped by Mongoose, turning the filter into {} — which matches the
  // first user in the collection. Both must be rejected before querying.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw invalidCredentials();
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');

  // Always runs a comparison, even with no user, to keep timing flat.
  const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    throw invalidCredentials();
  }

  // FR-8: a deactivated account cannot log in. Checked AFTER the password so
  // that a wrong password cannot be used to discover that an account exists
  // but is disabled — same error, same path, either way.
  if (!user.isActive) {
    throw invalidCredentials();
  }

  return user;
};

/**
 * FR-2: promote the request's session to an authenticated one.
 *
 * Takes the session object rather than the whole request, so the credential
 * and session logic stays out of the controller (ARCHITECTURE.md Section 2)
 * without dragging Express req/res into the service.
 */
/**
 * Carries the live session slot. It must be the object that owns `session`,
 * NOT the session itself — see the warning inside establishSession.
 */
export interface SessionCarrier {
  session: Session & Partial<SessionData>;
}

export const establishSession = (carrier: SessionCarrier, user: IUser): Promise<void> =>
  new Promise((resolve, reject) => {
    // Session fixation defence: a session id held before login must never
    // become the authenticated one. regenerate() issues a fresh id.
    carrier.session.regenerate((regenerateError) => {
      if (regenerateError) {
        reject(regenerateError);
        return;
      }

      // WARNING: regenerate() REPLACES carrier.session with a brand new Session
      // object. Every access below must go through the carrier so it reads the
      // new one. Writing to a reference captured before regenerate() stores the
      // user on the OLD, discarded id while the client is handed a cookie for
      // the new empty session — i.e. a login that silently authenticates
      // nobody. That bug shipped once; the test below pins it.
      carrier.session.userId = String(user._id);
      carrier.session.role = user.role;

      // Persist before responding, so the store cannot lag behind the cookie
      // we are about to hand the client.
      carrier.session.save((saveError) => {
        if (saveError) {
          reject(saveError);
          return;
        }
        resolve();
      });
    });
  });

/**
 * FR-4: end the session immediately.
 *
 * destroy() removes the record from the STORE, not just the cookie. Clearing
 * the cookie alone would leave a live session document that anyone holding the
 * old cookie value could keep using until its TTL expired.
 */
export const terminateSession = (carrier: SessionCarrier): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!carrier.session) {
      resolve();
      return;
    }

    carrier.session.destroy((destroyError) => {
      if (destroyError) {
        reject(destroyError);
        return;
      }
      resolve();
    });
  });

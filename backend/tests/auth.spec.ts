import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Role } from '../src/common/constants';
import {
  sessionStore,
  closeSessionStore,
  SESSION_INACTIVITY_MS,
  SESSION_COOKIE_NAME,
} from '../src/config/session';
import {
  loginRateLimitStore,
  LOGIN_RATE_LIMIT_MAX,
} from '../src/middleware/rateLimit.middleware';

// The database is the only thing mocked. Routing, controller, service, bcrypt,
// express-session and the error handler all run for real.
jest.mock('../src/models/User.model');

const mockedFindOne = User.findOne as unknown as jest.Mock;

const PASSWORD = 'S3cret!Passw0rd';
// Cost 4 purely for test speed; compare() is cost-agnostic.
const passwordHash = hashSync(PASSWORD, 4);

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: '507f1f77bcf86cd799439011',
  name: 'Marie Dupont',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: '507f1f77bcf86cd799439012',
  isActive: true,
  mustChangePassword: false,
  ...overrides,
});

/** Mirrors `User.findOne(...).select('+passwordHash')`. */
const findOneResolves = (user: unknown) => {
  mockedFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
};

const login = (body: unknown) => request(app).post('/api/v1/auth/login').send(body as object);

beforeEach(() => {
  jest.clearAllMocks();
  // D-025: the limiter is real middleware in the request path, so without a
  // reset these tests would exhaust each other's 5-attempt budget.
  loginRateLimitStore.resetAll?.();
});

afterAll(async () => {
  await closeSessionStore();
});

/** Reads back what the server actually stored under the issued cookie's sid. */
const storedSession = (setCookie: string[]): Promise<Record<string, unknown> | null> => {
  const raw = setCookie.find((c) => c.startsWith('recrutpro.sid='));
  // Cookie value is `s:<sid>.<signature>`, url-encoded.
  const sid = decodeURIComponent((raw as string).split('=')[1].split(';')[0])
    .replace(/^s:/, '')
    .split('.')[0];
  return new Promise((resolve, reject) =>
    // SessionData is a fixed-shape interface with no index signature, so it
    // needs the double assertion to be read as a bag of keys.
    sessionStore.get(sid, (err, sess) =>
      err ? reject(err) : resolve((sess as unknown as Record<string, unknown>) ?? null),
    ),
  );
};

describe('POST /auth/login — FR-1, FR-2, FR-3', () => {
  it('FR-1: accepts an email and a password and authenticates the user', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: '507f1f77bcf86cd799439011',
      name: 'Marie Dupont',
      email: 'marie@example.com',
      role: Role.Recruteur,
      departmentId: '507f1f77bcf86cd799439012',
      mustChangePassword: false,
      // D-091: null because this fixture has no photo. The field is asserted
      // rather than allowed through, so the shape stays pinned exactly.
      avatarUrl: null,
    });
  });

  it('FR-1: the email is looked up case-insensitively and trimmed', async () => {
    findOneResolves(makeUser());

    await login({ email: '  MARIE@Example.COM  ', password: PASSWORD });

    expect(mockedFindOne).toHaveBeenCalledWith({ email: 'marie@example.com' });
  });

  it('rule 3: the response never carries passwordHash', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(passwordHash);
    expect(res.body).not.toHaveProperty('isActive');
  });

  it('FR-2: a successful login issues a session cookie with a 30-minute window', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: PASSWORD });
    const cookies = res.headers['set-cookie'] as unknown as string[];

    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c) => c.startsWith('recrutpro.sid='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');

    // express-session expresses the window as an absolute Expires rather than
    // Max-Age, so assert the duration itself: it must be D-021's 30 minutes.
    const expires = /Expires=([^;]+)/.exec(sessionCookie as string)?.[1];
    expect(expires).toBeDefined();
    const windowMs = new Date(expires as string).getTime() - Date.now();
    expect(windowMs).toBeGreaterThan(SESSION_INACTIVITY_MS - 60_000);
    expect(windowMs).toBeLessThanOrEqual(SESSION_INACTIVITY_MS);
  });

  it('FR-2: the session the ISSUED COOKIE points at actually carries the user', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: PASSWORD });
    const stored = await storedSession(res.headers['set-cookie'] as unknown as string[]);

    // Regression guard. regenerate() swaps the session object out; writing to a
    // reference captured beforehand stored the user under the OLD id and handed
    // the client a cookie for a new EMPTY session — a login authenticating
    // nobody, which every RBAC check would then reject.
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe('507f1f77bcf86cd799439011');
    expect(stored?.role).toBe(Role.Recruteur);
  });

  it('FR-2: a failed login issues no session cookie', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('FR-3: a wrong password returns the single generic error', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: 'marie@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' },
    });
  });

  it('FR-3: an unknown email is INDISTINGUISHABLE from a wrong password', async () => {
    findOneResolves(makeUser());
    const wrongPassword = await login({ email: 'marie@example.com', password: 'wrong' });

    findOneResolves(null);
    const unknownEmail = await login({ email: 'personne@example.com', password: PASSWORD });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('FR-3 / FR-8: a deactivated account with the CORRECT password is rejected identically', async () => {
    findOneResolves(makeUser({ isActive: false }));

    const res = await login({ email: 'marie@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    // Same body as every other failure: no hint that the account exists.
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' },
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('FR-4: logout destroys the SERVER-SIDE session, not just the cookie', async () => {
    findOneResolves(makeUser());
    const loggedIn = await login({ email: 'marie@example.com', password: PASSWORD });
    const cookie = loggedIn.headers['set-cookie'] as unknown as string[];

    // Present before logout.
    expect(await storedSession(cookie)).not.toBeNull();

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(204);
    // The store record is gone — a stolen cookie is now worthless. Clearing the
    // cookie alone would have left this document alive until its TTL expired.
    expect(await storedSession(cookie)).toBeNull();
  });

  it('FR-4: logout clears the session cookie', async () => {
    findOneResolves(makeUser());
    const loggedIn = await login({ email: 'marie@example.com', password: PASSWORD });

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', loggedIn.headers['set-cookie'] as unknown as string[]);

    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    expect(cleared).toBeDefined();
    // Expiry in the past is how a cookie is deleted.
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
  });

  it('FR-4: logout is idempotent without a session', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
  });

  it('FR-10: the login response tells the client a change is required', async () => {
    findOneResolves(makeUser({ mustChangePassword: true }));

    const res = await login({ email: 'marie@example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('FR-10: a user owing a password change is refused protected routes', async () => {
    const user = makeUser({ mustChangePassword: true });
    findOneResolves(user);
    const loggedIn = await login({ email: 'marie@example.com', password: PASSWORD });
    (User.findById as unknown as jest.Mock).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', loggedIn.headers['set-cookie'] as unknown as string[])
      .send({ name: 'X' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('NFR-05: a NoSQL operator in place of the email never reaches the query', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: { $ne: null }, password: PASSWORD });

    expect(res.status).toBe(400);
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('D-028: successful logins do NOT consume the rate-limit budget', async () => {
    findOneResolves(makeUser());

    // Well past the 5-attempt limit, all succeeding.
    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX + 3; attempt += 1) {
      const res = await login({ email: 'marie@example.com', password: PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it('D-028: failures still count even after successful logins', async () => {
    findOneResolves(makeUser());
    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      await login({ email: 'marie@example.com', password: PASSWORD });
    }

    // The budget must be untouched by those successes.
    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      const res = await login({ email: 'marie@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const throttled = await login({ email: 'marie@example.com', password: 'wrong' });
    expect(throttled.status).toBe(429);
  });

  it('D-025: a 6th FAILED attempt from the same IP inside the window is throttled', async () => {
    findOneResolves(null);

    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      const res = await login({ email: 'marie@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const throttled = await login({ email: 'marie@example.com', password: 'wrong' });

    expect(throttled.status).toBe(429);
    // Must still match the Section 9 error shape, not express-rate-limit's
    // default plain-text body.
    expect(throttled.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
      },
    });
  });

  it('D-025: throttling short-circuits before the credential check', async () => {
    findOneResolves(null);
    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_MAX; attempt += 1) {
      await login({ email: 'marie@example.com', password: 'wrong' });
    }
    mockedFindOne.mockClear();

    await login({ email: 'marie@example.com', password: 'wrong' });

    // A throttled request must not reach the database at all — otherwise the
    // limiter would not actually relieve load under a brute-force attempt.
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('NFR-05 / NFR-09: a missing password is a 400 that names the problem', async () => {
    const res = await login({ email: 'marie@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/requis/i);
    expect(mockedFindOne).not.toHaveBeenCalled();
  });
});

describe('GET /auth/me — session rehydration (D-070, closes D-065)', () => {
  const signIn = async (user: Record<string, unknown>): Promise<string[]> => {
    findOneResolves(user);
    (User.findById as unknown as jest.Mock).mockResolvedValue(user);
    const res = await login({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'] as unknown as string[];
  };

  const me = (cookie?: string[]) => {
    const req = request(app).get('/api/v1/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('returns the signed-in user for a valid session cookie', async () => {
    const user = makeUser();
    const cookie = await signIn(user);

    const res = await me(cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: String(user.departmentId),
      mustChangePassword: false,
      avatarUrl: null,
    });
  });

  it('D-091: avatarUrl is the proxy path, never the Cloudinary URL', async () => {
    // What comes back must be the proxy route, derived from the handle. The
    // stored Cloudinary URL was DROPPED after a live check found it publicly
    // readable, so there is no longer a storage URL on the document at all —
    // which is why this asserts against the whole body, not just the field.
    const user = { ...makeUser(), avatarPublicId: 'recrutpro/avatars/x' };
    const cookie = await signIn(user);

    const res = await me(cookie);

    expect(res.body.avatarUrl).toBe(`/api/v1/users/${String(user._id)}/avatar`);
    expect(JSON.stringify(res.body)).not.toContain('cloudinary.com');
  });

  it('rule 3: never returns the password hash', async () => {
    const cookie = await signIn(makeUser());

    const res = await me(cookie);

    expect(res.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });

  it('401s an anonymous caller — that is the normal "signed out" answer', async () => {
    const res = await me();

    expect(res.status).toBe(401);
  });

  it('D-027: reflects a role changed AFTER login, because the user is reloaded per request', async () => {
    const user = makeUser();
    const cookie = await signIn(user);

    // An administrator changes the role mid-session (FR-7). The session stores
    // only userId/role (D-024), so a stale copy would keep the old answer.
    (User.findById as unknown as jest.Mock).mockResolvedValue(
      makeUser({ role: Role.Administrateur, departmentId: undefined }),
    );

    const res = await me(cookie);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(Role.Administrateur);
    expect(res.body.departmentId).toBeNull();
  });

  it('FR-8: a session whose account was deactivated is refused', async () => {
    const cookie = await signIn(makeUser());
    (User.findById as unknown as jest.Mock).mockResolvedValue(makeUser({ isActive: false }));

    const res = await me(cookie);

    expect(res.status).toBe(401);
  });

  it('FR-10: reachable while a password change is forced — a locked-out user still has an identity', async () => {
    const user = makeUser({ mustChangePassword: true });
    const cookie = await signIn(user);

    const res = await me(cookie);

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });
});

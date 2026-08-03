import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Role } from '../src/common/constants';
import { sessionStore, closeSessionStore, SESSION_INACTIVITY_MS } from '../src/config/session';

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
    sessionStore.get(sid, (err, sess) =>
      err ? reject(err) : resolve((sess as Record<string, unknown>) ?? null),
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

  it('NFR-05: a NoSQL operator in place of the email never reaches the query', async () => {
    findOneResolves(makeUser());

    const res = await login({ email: { $ne: null }, password: PASSWORD });

    expect(res.status).toBe(400);
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

import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { Notification } from '../src/models/Notification.model';
import { AuditLog } from '../src/models/AuditLog.model';
import { Role, NotificationType } from '../src/common/constants';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');
jest.mock('../src/models/Notification.model');
jest.mock('../src/models/AuditLog.model');

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedNotification = Notification as unknown as {
  find: jest.Mock;
  countDocuments: jest.Mock;
  findOneAndUpdate: jest.Mock;
  findOneAndDelete: jest.Mock;
};
const mockedAuditLog = AuditLog as unknown as { create: jest.Mock };

const PASSWORD = 'S3cret!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);

const MARIE_ID = new Types.ObjectId().toString();
const PIERRE_ID = new Types.ObjectId().toString();
const ADMIN_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();

const marie = {
  _id: MARIE_ID,
  name: 'Marie',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
};

const pierre = {
  ...marie,
  _id: PIERRE_ID,
  name: 'Pierre',
  email: 'pierre@example.com',
  role: Role.ResponsableHierarchique,
};

const admin = {
  ...marie,
  _id: ADMIN_ID,
  name: 'Admin',
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined,
};

interface StoredNotification {
  _id: string;
  userId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

/**
 * A small ownership-aware fake store rather than mocks returning canned rows.
 *
 * SESSION_NOTES' FR-35 lesson: the off-by-scope bug that got through the unit
 * tests was invisible because the test asserted on the QUERY OBJECT. These
 * tests assert on the ROWS RETURNED, compared across two principals, so a
 * scope clause that is silently dropped or overwritten fails here.
 */
let store: StoredNotification[];

const MARIE_OLD = new Types.ObjectId().toString();
const MARIE_NEW = new Types.ObjectId().toString();
const MARIE_READ = new Types.ObjectId().toString();
const PIERRE_ONE = new Types.ObjectId().toString();

const matches = (query: Record<string, unknown>): StoredNotification[] =>
  store
    .filter((row) => String(row.userId) === String(query.userId))
    .filter((row) => query.isRead === undefined || row.isRead === query.isRead)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

let lastSkip: number | undefined;
let lastLimit: number | undefined;
let lastSort: Record<string, number> | undefined;

const signInAs = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  mockedUser.findById.mockResolvedValue(who);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

let marieCookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  loginRateLimitStore.resetAll?.();
  lastSkip = undefined;
  lastLimit = undefined;
  lastSort = undefined;

  store = [
    {
      _id: MARIE_OLD,
      userId: MARIE_ID,
      type: NotificationType.ChangementEtape,
      message: 'Ancienne notification de Marie',
      isRead: false,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
    },
    {
      _id: MARIE_NEW,
      userId: MARIE_ID,
      type: NotificationType.EvaluationSoumise,
      message: 'Nouvelle notification de Marie',
      isRead: false,
      createdAt: new Date('2026-08-09T09:00:00.000Z'),
    },
    {
      _id: MARIE_READ,
      userId: MARIE_ID,
      type: NotificationType.ChangementEtape,
      message: 'Notification déjà lue de Marie',
      isRead: true,
      createdAt: new Date('2026-08-05T09:00:00.000Z'),
    },
    {
      _id: PIERRE_ONE,
      userId: PIERRE_ID,
      type: NotificationType.EntretienPlanifie,
      message: 'Entretien planifié pour Pierre',
      isRead: false,
      createdAt: new Date('2026-08-08T09:00:00.000Z'),
    },
  ];

  mockedNotification.find.mockImplementation((query: Record<string, unknown>) => {
    const rows = matches(query);
    return {
      sort: (sortSpec: Record<string, number>) => {
        lastSort = sortSpec;
        return {
          skip: (skip: number) => {
            lastSkip = skip;
            return {
              limit: (limit: number) => {
                lastLimit = limit;
                return Promise.resolve(rows.slice(skip, skip + limit));
              },
            };
          },
        };
      },
    };
  });

  mockedNotification.countDocuments.mockImplementation((query: Record<string, unknown>) =>
    Promise.resolve(matches(query).length),
  );

  // Ownership lives in the FILTER, so a query naming another user's id simply
  // matches nothing — which is what makes "not yours" and "not there" the same
  // code path (D-054).
  mockedNotification.findOneAndUpdate.mockImplementation((filter: Record<string, unknown>) => {
    const row = store.find(
      (n) => n._id === String(filter._id) && String(n.userId) === String(filter.userId),
    );
    if (!row) {
      return Promise.resolve(null);
    }
    row.isRead = true;
    return Promise.resolve(row);
  });

  mockedNotification.findOneAndDelete.mockImplementation((filter: Record<string, unknown>) => {
    const index = store.findIndex(
      (n) => n._id === String(filter._id) && String(n.userId) === String(filter.userId),
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    return Promise.resolve(store.splice(index, 1)[0]);
  });

  mockedAuditLog.create.mockResolvedValue({});

  marieCookie = await signInAs(marie);
});

describe('FR-43: notification panel — list', () => {
  test('FR-43: returns only the caller’s own notifications', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((n: { id: string }) => n.id)).not.toContain(PIERRE_ONE);
  });

  test('FR-43: a second principal sees THEIR rows and none of the first’s', async () => {
    const pierreCookie = await signInAs(pierre);
    const res = await request(app).get('/api/v1/notifications').set('Cookie', pierreCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(PIERRE_ONE);
    expect(res.body.map((n: { id: string }) => n.id)).not.toContain(MARIE_NEW);
  });

  test('FR-43: newest first', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(res.body.map((n: { id: string }) => n.id)).toEqual([MARIE_NEW, MARIE_READ, MARIE_OLD]);
    expect(lastSort).toEqual({ createdAt: -1, _id: 1 });
  });

  test('FR-43: each row carries the read/unread state', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    const read = res.body.find((n: { id: string }) => n.id === MARIE_READ);
    const unread = res.body.find((n: { id: string }) => n.id === MARIE_NEW);
    expect(read.isRead).toBe(true);
    expect(unread.isRead).toBe(false);
  });

  test('FR-43: row shape is exactly the five public fields, and never the recipient', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['createdAt', 'id', 'isRead', 'message', 'type'].sort(),
    );
    expect(res.body[0]).not.toHaveProperty('userId');
  });

  test('FR-43: X-Total-Count carries the pre-pagination total', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?limit=1')
      .set('Cookie', marieCookie);

    expect(res.body).toHaveLength(1);
    expect(res.headers['x-total-count']).toBe('3');
  });

  test('FR-43: isRead=false returns unread only — this is the unread badge count', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?isRead=false')
      .set('Cookie', marieCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((n: { isRead: boolean }) => n.isRead === false)).toBe(true);
    expect(res.headers['x-total-count']).toBe('2');
  });

  test('FR-43: isRead=true returns read only', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?isRead=true')
      .set('Cookie', marieCookie);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(MARIE_READ);
  });

  test('FR-43: isRead omitted returns both states', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(res.body).toHaveLength(3);
  });

  test('FR-43: isRead=maybe is refused, never ignored', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?isRead=maybe')
      .set('Cookie', marieCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedNotification.find).not.toHaveBeenCalled();
  });

  test('FR-43: pagination defaults to 25 / 0 (D-041)', async () => {
    await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(lastLimit).toBe(25);
    expect(lastSkip).toBe(0);
  });

  test('FR-43: two pages are non-overlapping and the total is stable across both', async () => {
    const page1 = await request(app)
      .get('/api/v1/notifications?limit=2&offset=0')
      .set('Cookie', marieCookie);
    const page2 = await request(app)
      .get('/api/v1/notifications?limit=2&offset=2')
      .set('Cookie', marieCookie);

    expect(page1.body).toHaveLength(2);
    expect(page2.body).toHaveLength(1);
    expect(page1.headers['x-total-count']).toBe('3');
    expect(page2.headers['x-total-count']).toBe('3');

    const ids = [...page1.body, ...page2.body].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(3);
  });

  test.each([
    ['limit=0', 'limit=0'],
    ['limit above the ceiling', 'limit=101'],
    ['non-numeric limit', 'limit=abc'],
    ['negative offset', 'offset=-1'],
    ['non-numeric offset', 'offset=x'],
  ])('FR-43: %s is a 400, not a silent clamp (D-041)', async (_label, qs) => {
    const res = await request(app).get(`/api/v1/notifications?${qs}`).set('Cookie', marieCookie);

    expect(res.status).toBe(400);
    expect(mockedNotification.find).not.toHaveBeenCalled();
  });

  test('FR-5: anonymous access is refused', async () => {
    const res = await request(app).get('/api/v1/notifications');

    expect(res.status).toBe(401);
    expect(mockedNotification.find).not.toHaveBeenCalled();
  });

  test.each([
    ['Recruteur', marie],
    ['Responsable hierarchique', pierre],
    ['Administrateur', admin],
  ])('D-054: %s reaches the panel — no role gate, only recipient scoping', async (_l, who) => {
    const cookie = await signInAs(who);
    const res = await request(app).get('/api/v1/notifications').set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});

describe('FR-43: mark as read', () => {
  test('FR-43: marks the notification read and returns it', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${MARIE_NEW}/read`)
      .set('Cookie', marieCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MARIE_NEW);
    expect(res.body.isRead).toBe(true);
    expect(store.find((n) => n._id === MARIE_NEW)?.isRead).toBe(true);
  });

  test('FR-43: idempotent — marking an already-read notification is a 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${MARIE_READ}/read`)
      .set('Cookie', marieCookie);

    expect(res.status).toBe(200);
    expect(res.body.isRead).toBe(true);
  });

  test('D-054: another user’s notification is a 404, and stays UNREAD', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${PIERRE_ONE}/read`)
      .set('Cookie', marieCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(store.find((n) => n._id === PIERRE_ONE)?.isRead).toBe(false);
  });

  test('D-054: an unknown id gives the SAME 404 as another user’s id', async () => {
    const unknown = await request(app)
      .patch(`/api/v1/notifications/${new Types.ObjectId().toString()}/read`)
      .set('Cookie', marieCookie);
    const foreign = await request(app)
      .patch(`/api/v1/notifications/${PIERRE_ONE}/read`)
      .set('Cookie', marieCookie);

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(foreign.body);
  });

  test('a malformed id is a 404, not a cast error, and runs no query', async () => {
    const res = await request(app)
      .patch('/api/v1/notifications/not-an-id/read')
      .set('Cookie', marieCookie);

    expect(res.status).toBe(404);
    expect(mockedNotification.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('FR-5: anonymous access is refused', async () => {
    const res = await request(app).patch(`/api/v1/notifications/${MARIE_NEW}/read`);

    expect(res.status).toBe(401);
    expect(mockedNotification.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('FR-44: manual deletion', () => {
  test('FR-44: deletes the notification and returns 204 with no body', async () => {
    const res = await request(app)
      .delete(`/api/v1/notifications/${MARIE_NEW}`)
      .set('Cookie', marieCookie);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(store.find((n) => n._id === MARIE_NEW)).toBeUndefined();
  });

  test('FR-44: the deleted notification is gone from the panel afterwards', async () => {
    await request(app).delete(`/api/v1/notifications/${MARIE_NEW}`).set('Cookie', marieCookie);
    const res = await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((n: { id: string }) => n.id)).not.toContain(MARIE_NEW);
    expect(res.headers['x-total-count']).toBe('2');
  });

  test('D-054: deleting twice is a 404 — deliberately not idempotent', async () => {
    const first = await request(app)
      .delete(`/api/v1/notifications/${MARIE_NEW}`)
      .set('Cookie', marieCookie);
    const second = await request(app)
      .delete(`/api/v1/notifications/${MARIE_NEW}`)
      .set('Cookie', marieCookie);

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });

  test('D-054: another user’s notification is a 404 and is NOT deleted', async () => {
    const res = await request(app)
      .delete(`/api/v1/notifications/${PIERRE_ONE}`)
      .set('Cookie', marieCookie);

    expect(res.status).toBe(404);
    expect(store.find((n) => n._id === PIERRE_ONE)).toBeDefined();

    // and Pierre can still see it
    const pierreCookie = await signInAs(pierre);
    const panel = await request(app).get('/api/v1/notifications').set('Cookie', pierreCookie);
    expect(panel.body).toHaveLength(1);
  });

  test('a malformed id is a 404, not a cast error, and runs no query', async () => {
    const res = await request(app)
      .delete('/api/v1/notifications/not-an-id')
      .set('Cookie', marieCookie);

    expect(res.status).toBe(404);
    expect(mockedNotification.findOneAndDelete).not.toHaveBeenCalled();
  });

  test('FR-5: anonymous access is refused, and nothing is deleted', async () => {
    const res = await request(app).delete(`/api/v1/notifications/${MARIE_NEW}`);

    expect(res.status).toBe(401);
    expect(mockedNotification.findOneAndDelete).not.toHaveBeenCalled();
    expect(store.find((n) => n._id === MARIE_NEW)).toBeDefined();
  });
});

describe('D-054: the panel writes no audit entries', () => {
  test('listing, marking read and deleting are not audited', async () => {
    await request(app).get('/api/v1/notifications').set('Cookie', marieCookie);
    await request(app)
      .patch(`/api/v1/notifications/${MARIE_NEW}/read`)
      .set('Cookie', marieCookie);
    await request(app).delete(`/api/v1/notifications/${MARIE_OLD}`).set('Cookie', marieCookie);

    expect(mockedAuditLog.create).not.toHaveBeenCalled();
  });
});

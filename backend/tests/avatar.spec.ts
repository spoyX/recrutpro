import request from 'supertest';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { app } from '../src/app';
import { User } from '../src/models/User.model';
import { cloudinary } from '../src/config/cloudinary';
import { MAX_AVATAR_BYTES } from '../src/middleware/upload.middleware';
import { Role } from '../src/common/constants';
import { closeSessionStore } from '../src/config/session';
import { loginRateLimitStore } from '../src/middleware/rateLimit.middleware';

jest.mock('../src/models/User.model');

const mockedUser = User as unknown as {
  findOne: jest.Mock;
  findById: jest.Mock;
  findByIdAndUpdate: jest.Mock;
};

const PASSWORD = 'Adm1n!Passw0rd';
const passwordHash = hashSync(PASSWORD, 4);
const ME_ID = new Types.ObjectId().toString();
const OTHER_ID = new Types.ObjectId().toString();
const DEPT_ID = new Types.ObjectId().toString();

const CLOUDINARY_URL =
  'https://res.cloudinary.com/demo/image/authenticated/s--sig--/recrutpro/avatars/me.jpg';
const PUBLIC_ID = 'recrutpro/avatars/me';

const me = {
  _id: ME_ID,
  name: 'Marie Dupont',
  email: 'marie@example.com',
  passwordHash,
  role: Role.Recruteur,
  departmentId: DEPT_ID,
  isActive: true,
  mustChangePassword: false,
  avatarPublicId: undefined as string | undefined,
};

/**
 * An ADMINISTRATEUR, needed to prove route ABSENCE rather than mere refusal.
 * `/users` mounts a router-wide requireRole(Administrateur) after the avatar
 * routes, so a Recruteur asking for `POST /users/:id/avatar` is stopped by that
 * guard with a 403 — which proves they were refused, not that the route does
 * not exist. Only the role that passes every guard can demonstrate the latter.
 */
const adminUser = {
  ...me,
  _id: new Types.ObjectId().toString(),
  email: 'admin@example.com',
  role: Role.Administrateur,
  departmentId: undefined as string | undefined,
};

/** Real signatures, not plausible-looking bytes. */
const jpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x11)]);
const pngBuffer = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0x22),
]);
const webpBuffer = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.alloc(32, 0x33),
]);

/** A Windows executable renamed to .jpg — the exact D-007 threat. */
const exeBuffer = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0x90)]);

/** RIFF, but a WAV rather than a WebP. The reason the check reads offset 8. */
const wavBuffer = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE'),
  Buffer.alloc(32, 0x44),
]);

let uploadStreamSpy: jest.SpyInstance;
let destroySpy: jest.SpyInstance;
let signedUrlSpy: jest.SpyInstance;
let fetchSpy: jest.SpyInstance;

/**
 * `User.findById` is called by TWO different things on every request to
 * `GET /users/:id/avatar`: requireAuth reloading the session user (D-027), and
 * the service loading the target. Resolving one document for both makes the
 * caller and the subject the same person, which is exactly the case these
 * tests must NOT accidentally prove. So the mock answers by id.
 */
let targetUser: Record<string, unknown> | null = null;

const setTarget = (doc: Record<string, unknown> | null): void => {
  targetUser = doc;
};

const installFindById = (): void => {
  mockedUser.findById.mockImplementation((id: unknown) => {
    if (String(id) === ME_ID) return Promise.resolve(me);
    if (String(id) === String(adminUser._id)) return Promise.resolve(adminUser);
    return Promise.resolve(targetUser);
  });
};

const signIn = async (who: Record<string, unknown>): Promise<string[]> => {
  mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(who) });
  installFindById();
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: who.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'] as unknown as string[];
};

let cookie: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  loginRateLimitStore.resetAll?.();

  me.avatarPublicId = undefined;
  targetUser = null;

  mockedUser.findByIdAndUpdate.mockImplementation((_id: unknown, update: Record<string, unknown>) =>
    Promise.resolve({
      ...me,
      ...(update.$unset
        ? { avatarPublicId: undefined }
        : { avatarPublicId: update.avatarPublicId }),
    }),
  );

  uploadStreamSpy = jest
    .spyOn(cloudinary.uploader, 'upload_stream')
    .mockImplementation(((_opts: unknown, callback: (e: unknown, r: unknown) => void) => ({
      end: () => callback(null, { secure_url: CLOUDINARY_URL, public_id: PUBLIC_ID }),
    })) as never);

  destroySpy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' } as never);

  signedUrlSpy = jest
    .spyOn(cloudinary.utils, 'private_download_url')
    .mockReturnValue(`${CLOUDINARY_URL}?signed=1`);

  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    arrayBuffer: async () => jpegBuffer.buffer.slice(0, jpegBuffer.length),
  } as never);

  cookie = await signIn(me);
});

afterAll(async () => {
  await closeSessionStore();
});

const upload = (buffer: Buffer, filename: string, contentType: string) =>
  request(app)
    .post('/api/v1/users/me/avatar')
    .set('Cookie', cookie)
    .attach('file', buffer, { filename, contentType });

describe('Profile image — D-091', () => {
  // -------------------------------------------------------------- upload
  describe('POST /users/me/avatar', () => {
    it('accepts a JPEG and stores the public id — and ONLY that', async () => {
      const res = await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      expect(res.status).toBe(200);
      // The HANDLE ONLY. Storing Cloudinary's `secure_url` beside it was the
      // ratified design; a live fetch of that value with no credentials
      // returned 200, so it is not stored at all now.
      expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith(
        ME_ID,
        { avatarPublicId: PUBLIC_ID },
        { new: true },
      );
    });

    it('accepts PNG and WebP too', async () => {
      expect((await upload(pngBuffer, 'me.png', 'image/png')).status).toBe(200);
      expect((await upload(webpBuffer, 'me.webp', 'image/webp')).status).toBe(200);
    });

    it('D-091: the RESPONSE carries the proxy path, never the Cloudinary URL', async () => {
      const res = await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      expect(res.body.avatarUrl).toBe(`/api/v1/users/${ME_ID}/avatar`);
      // The whole body, not just that field — the storage URL must not reach
      // the client through any other key either.
      expect(JSON.stringify(res.body)).not.toContain('cloudinary');
    });

    it('D-007: a renamed executable is refused, and NOTHING is uploaded', async () => {
      const res = await upload(exeBuffer, 'me.jpg', 'image/jpeg');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_CONTENT');
      // The point of the ordering: validation runs before any network call.
      expect(uploadStreamSpy).not.toHaveBeenCalled();
      expect(mockedUser.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('D-007: a WAV declared as WebP is refused — RIFF alone is not enough', async () => {
      const res = await upload(wavBuffer, 'me.webp', 'image/webp');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_CONTENT');
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('refuses a declared type outside the allowlist, SVG included', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const res = await upload(svg, 'me.svg', 'image/svg+xml');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('refuses a file over 2 Mo', async () => {
      const tooBig = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(MAX_AVATAR_BYTES, 0x11),
      ]);

      const res = await upload(tooBig, 'me.jpg', 'image/jpeg');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('refuses an empty body with a message naming the field', async () => {
      const res = await request(app).post('/api/v1/users/me/avatar').set('Cookie', cookie);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('file');
    });

    it('replacing DESTROYS the previous asset (the opposite of FR-22)', async () => {
      me.avatarPublicId = 'recrutpro/avatars/old';
      cookie = await signIn(me);

      const res = await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      expect(res.status).toBe(200);
      expect(destroySpy).toHaveBeenCalledWith(
        'recrutpro/avatars/old',
        expect.objectContaining({ resource_type: 'image', type: 'authenticated' }),
      );
    });

    it('a first upload destroys nothing', async () => {
      await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('a failed remote delete does not fail an upload that succeeded', async () => {
      me.avatarPublicId = 'recrutpro/avatars/old';
      cookie = await signIn(me);
      destroySpy.mockRejectedValue(new Error('cloudinary down'));

      const res = await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      // Worst case is one orphaned asset, which beats refusing a valid photo.
      expect(res.status).toBe(200);
    });

    it('uploads as an authenticated IMAGE, and keeps no storage URL', async () => {
      await upload(jpegBuffer, 'me.jpg', 'image/jpeg');

      expect(uploadStreamSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'authenticated', resource_type: 'image' }),
        expect.any(Function),
      );
      // `authenticated` is NOT by itself the guarantee — for an image,
      // Cloudinary's secure_url embeds a permanently valid signature. What
      // makes the photo unreachable is that the URL is never persisted and
      // never sent; delivery signs a 60-second URL from the handle instead.
      const written = mockedUser.findByIdAndUpdate.mock.calls[0][1] as Record<string, unknown>;
      expect(JSON.stringify(written)).not.toContain('cloudinary');
    });

    it('requires a session', async () => {
      const res = await request(app)
        .post('/api/v1/users/me/avatar')
        .attach('file', jpegBuffer, { filename: 'me.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------- remove
  describe('DELETE /users/me/avatar', () => {
    it('clears BOTH fields and destroys the asset', async () => {
      me.avatarPublicId = PUBLIC_ID;
      cookie = await signIn(me);

      const res = await request(app).delete('/api/v1/users/me/avatar').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith(
        ME_ID,
        { $unset: { avatarPublicId: '' } },
        { new: true },
      );
      expect(destroySpy).toHaveBeenCalledWith(PUBLIC_ID, expect.any(Object));
      expect(res.body.avatarUrl).toBeNull();
    });

    it('is idempotent when there is no photo', async () => {
      const res = await request(app).delete('/api/v1/users/me/avatar').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('requires a session', async () => {
      const res = await request(app).delete('/api/v1/users/me/avatar');

      expect(res.status).toBe(401);
    });
  });

  // ------------------------------------------------------------ download
  describe('GET /users/:id/avatar', () => {
    const withAvatar = { _id: OTHER_ID, avatarPublicId: 'recrutpro/avatars/other' };

    it('proxies the bytes and never leaks a storage URL', async () => {
      setTarget(withAvatar);

      const res = await request(app)
        .get(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      // The signed URL is generated and consumed server-side only.
      expect(signedUrlSpy).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(`${CLOUDINARY_URL}?signed=1`);
      expect(JSON.stringify(res.headers)).not.toContain('cloudinary');
      expect(res.body.toString('latin1')).not.toContain('cloudinary');
    });

    it('the signed URL expires, and is authenticated', async () => {
      setTarget(withAvatar);

      await request(app).get(`/api/v1/users/${OTHER_ID}/avatar`).set('Cookie', cookie);

      const options = signedUrlSpy.mock.calls[0][2] as { expires_at: number; type: string };
      expect(options.type).toBe('authenticated');
      expect(options.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(options.expires_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    });

    it('is cacheable but PRIVATE — an avatar repeats down a list page', async () => {
      setTarget(withAvatar);

      const res = await request(app)
        .get(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', cookie);

      expect(res.headers['cache-control']).toContain('private');
      expect(res.headers['cache-control']).not.toContain('public');
    });

    it('404s when the account has no photo, without calling Cloudinary', async () => {
      setTarget({ _id: OTHER_ID });

      const res = await request(app)
        .get(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', cookie);

      expect(res.status).toBe(404);
      expect(signedUrlSpy).not.toHaveBeenCalled();
    });

    it('404s for an unknown account and for a malformed id', async () => {
      setTarget(null);
      expect((await request(app).get(`/api/v1/users/${OTHER_ID}/avatar`).set('Cookie', cookie)).status).toBe(404);

      expect((await request(app).get('/api/v1/users/not-an-id/avatar').set('Cookie', cookie)).status).toBe(404);
    });

    it('is open to any authenticated role, not just an administrator', async () => {
      // The caller here is a Recruteur, and the target is somebody else.
      setTarget(withAvatar);

      const res = await request(app)
        .get(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
    });

    it('requires a session', async () => {
      const res = await request(app).get(`/api/v1/users/${OTHER_ID}/avatar`);

      expect(res.status).toBe(401);
    });
  });

  // ------------------------------------------------------------ the shape
  describe('the `me` routes cannot address another account', () => {
    it('a Recruteur is refused a write against another id', async () => {
      // Refused, but by the router-wide Administrateur guard rather than by
      // route absence — so this asserts the outcome, and the test BELOW is
      // what actually proves D-091's structural claim.
      const res = await request(app)
        .post(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', cookie)
        .attach('file', jpegBuffer, { filename: 'me.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(403);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
    });

    it('D-091: not even an ADMINISTRATEUR can write another account’s photo, because the route does not exist', async () => {
      // The role that passes every guard on this router. A 404 here is the
      // whole point: there is no id-taking write route to forget a check on.
      const adminCookie = await signIn(adminUser);

      const posted = await request(app)
        .post(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', adminCookie)
        .attach('file', jpegBuffer, { filename: 'me.jpg', contentType: 'image/jpeg' });
      const deleted = await request(app)
        .delete(`/api/v1/users/${OTHER_ID}/avatar`)
        .set('Cookie', adminCookie);

      expect(posted.status).toBe(404);
      expect(deleted.status).toBe(404);
      expect(uploadStreamSpy).not.toHaveBeenCalled();
      expect(destroySpy).not.toHaveBeenCalled();
      expect(mockedUser.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('the upload writes to the SESSION user, never to a body-supplied id', async () => {
      await request(app)
        .post('/api/v1/users/me/avatar')
        .set('Cookie', cookie)
        .field('userId', OTHER_ID)
        .attach('file', jpegBuffer, { filename: 'me.jpg', contentType: 'image/jpeg' });

      expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith(
        ME_ID,
        expect.any(Object),
        expect.any(Object),
      );
    });
  });
});

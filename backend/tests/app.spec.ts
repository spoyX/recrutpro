import request from 'supertest';
import { app } from '../src/app';
import { SESSION_INACTIVITY_MS, closeSessionStore } from '../src/config/session';

afterAll(async () => {
  // Without this the Mongo client behind connect-mongo keeps Jest alive.
  await closeSessionStore();
});

describe('Express entrypoint — ARCHITECTURE.md Section 9', () => {
  it('health check responds 200 with a status payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('health check is outside the /api/v1 contract (D-019)', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(404);
  });

  it('an unknown route returns the {error:{code,message}} shape', async () => {
    const res = await request(app).get('/api/v1/inexistant');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
    // NFR-09: the message must name the problem, not just the status
    expect(res.body.error.message).toContain('/api/v1/inexistant');
  });

  it('the error shape carries no extra top-level keys', async () => {
    const res = await request(app).get('/nope');
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message']);
  });

  it('FR-2: the inactivity window is 30 minutes', () => {
    expect(SESSION_INACTIVITY_MS).toBe(30 * 60 * 1000);
  });

  it('FR-2: an anonymous request creates no session cookie', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('serves the OpenAPI spec with the shared Error schema', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('RecrutPro API');
    expect(res.body.servers[0].url).toBe('/api/v1');
    expect(res.body.components.schemas.Error.properties.error).toBeDefined();
  });
});

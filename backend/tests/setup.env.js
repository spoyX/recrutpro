/**
 * Runs before any test module is imported, and therefore before `app.ts`
 * evaluates `dotenv/config`.
 *
 * D-021 lets the session store fall back to MemoryStore outside production so
 * the suite needs no database. That fallback keys off MONGO_URI being absent —
 * which held only as long as no backend/.env existed. Once one does (D-040
 * requires it for the Cloudinary credentials), dotenv populates MONGO_URI and
 * every spec silently starts talking to the real MongoDB, ending in
 * MongoExpiredSessionError as connect-mongo races the store teardown.
 *
 * dotenv never overwrites a key already present in process.env, and an empty
 * string counts as present — so pinning these here keeps the suite hermetic
 * whatever the developer's .env happens to contain.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
process.env.SESSION_SECRET = 'test-only-secret';

// D-040: never let a real Cloudinary credential reach the suite. The resume
// specs stub the SDK; these only have to be present so the 503 guard passes.
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

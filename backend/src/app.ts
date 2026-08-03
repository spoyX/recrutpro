import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { connectDb } from './config/db';
import { sessionMiddleware } from './config/session';
import { swaggerSpec } from './docs/swagger';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

export const app = express();

app.use(express.json());

// Session-based auth infrastructure (D-001: sessions, never JWT). Mounted
// before any router so every downstream handler sees req.session. The login
// and logout endpoints that populate it are Phase 3 Auth module work.
app.use(sessionMiddleware);

/**
 * Operational endpoints. Deliberately OUTSIDE the /api/v1 contract in
 * ARCHITECTURE.md Section 9, which stays reserved for business resources
 * (D-019). Kept inline rather than in routes/ + controllers/ because neither
 * carries any domain logic to separate.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// Domain routers mount under /api/v1 here as Phase 3 builds each module.

// Must stay last, and in this order: unmatched routes become an AppError,
// which the error handler then serialises as {error:{code,message}}.
app.use(notFoundHandler);
app.use(errorHandler);

// Exported above for Supertest; only listens when run as the entrypoint,
// which is how the container starts it (CMD ["node", "dist/app.js"]).
if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  connectDb()
    .then(() => {
      app.listen(port, () => {
        console.log(`RecrutPro API écoute sur le port ${port}`);
      });
    })
    .catch((err: unknown) => {
      console.error('[startup] connexion à MongoDB impossible', err);
      process.exit(1);
    });
}

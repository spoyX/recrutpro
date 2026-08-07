import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { connectDb } from './config/db';
import { sessionMiddleware } from './config/session';
import { swaggerSpec } from './docs/swagger';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import departmentRoutes from './routes/department.routes';
import jobPositionRoutes from './routes/jobPosition.routes';
import candidateRoutes from './routes/candidate.routes';
import interviewRoutes from './routes/interview.routes';

export const app = express();

// Exactly one proxy hop (nginx, D-014), never `true`. Without this, req.ip is
// the nginx container's address for EVERY request, so the login rate limiter
// (D-025) would key all users to one bucket and lock the whole company out
// after five attempts. `true` is equally wrong: it would trust a client-supplied
// X-Forwarded-For and let an attacker mint a fresh bucket per request.
app.set('trust proxy', 1);

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
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/job-positions', jobPositionRoutes);
app.use('/api/v1/candidates', candidateRoutes);
app.use('/api/v1/interviews', interviewRoutes);

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

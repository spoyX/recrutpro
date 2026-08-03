import { ErrorRequestHandler, RequestHandler } from 'express';
import { Error as MongooseError } from 'mongoose';
import { AppError } from '../common/errors';

/** Any request that matched no route. Must be mounted after every router. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(
      404,
      'NOT_FOUND',
      `La route ${req.method} ${req.originalUrl} n'existe pas. Vérifiez l'URL et la méthode HTTP.`,
    ),
  );
};

/**
 * Global error handler. Every response body it produces has the
 * `{error:{code,message}}` shape from ARCHITECTURE.md Section 9.
 *
 * Messages are written to satisfy NFR-09: state the problem and the corrective
 * action. The 500 branch deliberately says nothing specific — leaking a stack
 * trace or driver message to the client is exactly what NFR-04 rules out.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof MongooseError.ValidationError) {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(' ');
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
    return;
  }

  // Unexpected: log server-side for diagnosis, tell the client nothing useful.
  console.error('[unhandled]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: "Une erreur interne est survenue. Réessayez, puis contactez l'administrateur si le problème persiste.",
    },
  });
};

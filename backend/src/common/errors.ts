/**
 * Operational error carrying the HTTP status and the machine-readable code
 * that ARCHITECTURE.md Section 9 requires in `{error:{code,message}}`.
 *
 * Services throw these; the global error handler serialises them. Anything
 * NOT an AppError is treated as an unexpected fault and reported as a generic
 * 500, so internal details never reach the client.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

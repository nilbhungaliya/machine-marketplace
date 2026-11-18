/**
 * Services throw these; the central error handler (plugins/error-handler.ts)
 * maps them to `{ error, code }` with the right HTTP status.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  /** `code` defaults to VALIDATION_ERROR; pass a specific one (e.g. INVALID_PARENT) when clients branch on it. */
  constructor(message: string, details?: Record<string, unknown>, code = 'VALIDATION_ERROR') {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super(`${what} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, code: string) {
    super(message, 429, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, code: string) {
    super(message, 503, code);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, 413, code, details);
  }
}

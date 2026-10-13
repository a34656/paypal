export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 422,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Errors whose message is safe to show to the client. Never include secrets or stacks. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new AppError("CONFLICT", msg, details);
export const forbidden = (msg = "Not permitted") => new AppError("FORBIDDEN", msg);
export const precondition = (msg: string, details?: unknown) => new AppError("PRECONDITION_FAILED", msg, details);

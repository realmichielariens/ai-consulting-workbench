// API error mapping (packages/core/src/api.ts ApiError/ApiErrorCode). Services
// throw ApiHttpError; routes.ts's global error handler turns it into the
// documented HTTP status + body. Routes themselves never decide status codes
// (CLAUDE.md rule 12: no business logic in routes).

import type { ApiErrorCode } from "@workbench/core";

export class ApiHttpError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export const notFound = (message: string): ApiHttpError => new ApiHttpError("not_found", message);
export const invalid = (message: string): ApiHttpError => new ApiHttpError("invalid", message);
export const conflict = (message: string): ApiHttpError => new ApiHttpError("conflict", message);
export const illegalTransition = (message: string): ApiHttpError => new ApiHttpError("illegal_transition", message);

export const HTTP_STATUS_FOR: Record<ApiErrorCode, number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  illegal_transition: 409,
  internal: 500,
};

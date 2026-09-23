// API error envelope padrão

export interface ApiError {
  error: string;
  message: string;
  retryAfter?: number;
}

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500,
} as const;

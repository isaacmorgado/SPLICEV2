/**
 * Centralized middleware utilities for API endpoints
 * Provides error handling, logging, CORS, and request validation
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
  timestamp: string;
}

export interface RequestContext {
  requestId: string;
  startTime: number;
  userId?: string;
  path: string;
  method: string;
  ip: string;
}

/**
 * Generate unique request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create request context for logging and tracking
 */
export function createRequestContext(req: VercelRequest): RequestContext {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim()
    : 'unknown';

  return {
    requestId: generateRequestId(),
    startTime: Date.now(),
    path: req.url || 'unknown',
    method: req.method || 'UNKNOWN',
    ip,
  };
}

/**
 * Structured logger for API requests
 */
export class ApiLogger {
  private context: RequestContext;

  constructor(context: RequestContext) {
    this.context = context;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
    const logEntry = {
      level,
      message,
      requestId: this.context.requestId,
      userId: this.context.userId,
      path: this.context.path,
      method: this.context.method,
      ip: this.context.ip,
      timestamp: new Date().toISOString(),
      ...(data && { data }),
    };

    // Use console methods for different levels
    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown) {
    const errorData =
      error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : error;
    this.log('error', message, errorData);
  }

  setUserId(userId: string) {
    this.context.userId = userId;
  }

  complete(statusCode: number) {
    const duration = Date.now() - this.context.startTime;
    this.info('Request completed', { statusCode, durationMs: duration });
  }
}

/**
 * Standard error response builder
 */
export function createErrorResponse(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): ApiError {
  return {
    code,
    message,
    statusCode,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Common error responses
 */
export const ErrorResponses = {
  UNAUTHORIZED: createErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
  FORBIDDEN: createErrorResponse(403, 'FORBIDDEN', 'Access denied'),
  NOT_FOUND: createErrorResponse(404, 'NOT_FOUND', 'Resource not found'),
  METHOD_NOT_ALLOWED: createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'),
  VALIDATION_ERROR: (details?: unknown) =>
    createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid request data', details),
  RATE_LIMIT_EXCEEDED: (retryAfter?: number) =>
    createErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', { retryAfter }),
  INTERNAL_ERROR: createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'),
  SERVICE_UNAVAILABLE: createErrorResponse(
    503,
    'SERVICE_UNAVAILABLE',
    'Service temporarily unavailable'
  ),
};

/**
 * Centralized error handler
 * Catches all errors and returns consistent error responses
 */
export async function withErrorHandler<T>(
  handler: (req: VercelRequest, res: VercelResponse, logger: ApiLogger) => Promise<T>
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const context = createRequestContext(req);
    const logger = new ApiLogger(context);

    logger.info('Request received', {
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
    });

    try {
      await handler(req, res, logger);
      logger.complete(res.statusCode || 200);
    } catch (error) {
      logger.error('Request failed', error);

      // Determine error response
      let errorResponse: ApiError;

      if (error && typeof error === 'object' && 'statusCode' in error) {
        // Custom error with statusCode
        errorResponse = error as ApiError;
      } else if (error instanceof Error) {
        // Generic error
        errorResponse = createErrorResponse(
          500,
          'INTERNAL_ERROR',
          process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
          process.env.NODE_ENV === 'production' ? undefined : { stack: error.stack }
        );
      } else {
        // Unknown error type
        errorResponse = ErrorResponses.INTERNAL_ERROR;
      }

      res.status(errorResponse.statusCode).json(errorResponse);
      logger.complete(errorResponse.statusCode);
    }
  };
}

/**
 * Method validator middleware
 * Ensures request uses allowed HTTP methods
 */
export function validateMethod(allowedMethods: string[]) {
  return (req: VercelRequest, res: VercelResponse): boolean => {
    if (!req.method || !allowedMethods.includes(req.method)) {
      res.status(405).json(ErrorResponses.METHOD_NOT_ALLOWED);
      return false;
    }
    return true;
  };
}

/**
 * Request body validator
 * Validates required fields are present
 */
export function validateBody<T extends Record<string, unknown>>(
  requiredFields: (keyof T)[]
): (body: unknown) => { valid: boolean; missing?: string[]; body?: T } {
  return (body: unknown) => {
    if (!body || typeof body !== 'object') {
      return { valid: false, missing: requiredFields as string[] };
    }

    const missing = requiredFields.filter((field) => !(field in body));
    if (missing.length > 0) {
      return { valid: false, missing: missing as string[] };
    }

    return { valid: true, body: body as T };
  };
}

/**
 * CORS headers helper
 * Already configured in vercel.json, but this can be used for specific endpoints
 */
export function setCorsHeaders(res: VercelResponse, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Handle OPTIONS preflight requests
 */
export function handleCorsPreFlight(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(200).end();
    return true;
  }
  return false;
}

/**
 * Async handler wrapper with error catching
 * Simpler alternative to withErrorHandler for basic endpoints
 */
export function asyncHandler(handler: (req: VercelRequest, res: VercelResponse) => Promise<void>) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Unhandled error:', error);
      const errorResponse =
        error instanceof Error
          ? createErrorResponse(500, 'INTERNAL_ERROR', error.message)
          : ErrorResponses.INTERNAL_ERROR;
      res.status(errorResponse.statusCode).json(errorResponse);
    }
  };
}

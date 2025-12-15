import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from './_lib/db';

interface HealthCheck {
  service: string;
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  version: string;
}

/**
 * Health check endpoint for the Splice backend.
 *
 * GET /api/health
 *
 * Returns overall health status and individual service checks.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const checks: HealthCheck[] = [];

  // Check database connection
  const dbCheck = await checkDatabase();
  checks.push(dbCheck);

  // Check environment configuration
  const envCheck = checkEnvironment();
  checks.push(envCheck);

  // Determine overall status
  const unhealthyCount = checks.filter((c) => c.status === 'unhealthy').length;
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';

  if (unhealthyCount === 0) {
    overallStatus = 'healthy';
  } else if (unhealthyCount < checks.length) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'unhealthy';
  }

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
  };

  // Return appropriate status code
  const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
  res.status(statusCode).json(response);
}

/**
 * Check database connectivity and latency.
 */
async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();

  try {
    // Simple query to verify connection
    await sql`SELECT 1 as check`;
    const latencyMs = Date.now() - start;

    return {
      service: 'database',
      status: 'healthy',
      latencyMs,
    };
  } catch (error) {
    return {
      service: 'database',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Check required environment variables are configured.
 */
function checkEnvironment(): HealthCheck {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'STRIPE_SECRET_KEY'];

  const optional = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'STRIPE_WEBHOOK_SECRET'];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    return {
      service: 'environment',
      status: 'unhealthy',
      error: `Missing required env vars: ${missing.join(', ')}`,
    };
  }

  // Warn about optional but recommended vars (but don't fail)
  const missingOptional = optional.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    return {
      service: 'environment',
      status: 'healthy', // Still healthy, but could note the missing optional vars
    };
  }

  return {
    service: 'environment',
    status: 'healthy',
  };
}

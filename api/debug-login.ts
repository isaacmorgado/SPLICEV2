import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const steps: string[] = [];

  try {
    steps.push('1. Starting imports');

    const db = await import('../lib/db.js');
    steps.push('2. db imported');

    await import('../lib/auth.js');
    steps.push('3. auth imported');

    const rateLimit = await import('../lib/rate-limit.js');
    steps.push('4. rate-limit imported');

    const { getSql } = db;
    steps.push('5. getSql extracted');

    const { checkRateLimit, RATE_LIMITS, getClientIP, checkAccountLockout, validateEmail } =
      rateLimit;
    steps.push('6. rate-limit functions extracted');

    // Test getSql
    const sql = await getSql();
    steps.push('7. getSql() called');

    // Test a simple query
    await sql`SELECT 1 as test`;
    steps.push('8. Simple query succeeded');

    // Test checkRateLimit
    const clientIP = getClientIP(req);
    steps.push(`9. Got client IP: ${clientIP}`);

    const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.login);
    steps.push(`10. Rate limit check complete: allowed=${rateLimitResult.allowed}`);

    // Test checkAccountLockout
    const testEmail = 'test@example.com';
    const isValidEmail = validateEmail(testEmail);
    steps.push(`11. validateEmail: ${isValidEmail}`);

    const lockoutResult = await checkAccountLockout(testEmail);
    steps.push(`12. checkAccountLockout complete: locked=${lockoutResult.locked}`);

    res.status(200).json({
      success: true,
      steps,
      rateLimitResult,
      lockoutResult,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      steps,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

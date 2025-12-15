import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Test importing a lib module that itself imports from db
    const rateLimit = await import('../lib/rate-limit.js');

    // Get exported functions
    const exports = Object.keys(rateLimit);

    res.status(200).json({
      success: true,
      message: 'Lib chain import works!',
      availableFunctions: exports,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

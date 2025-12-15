import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Dynamic import of local file (similar to how health.ts imports npm packages)
    const { hello } = await import('../lib/db-minimal');
    const message = hello();
    res.status(200).json({
      success: true,
      message,
      test: 'dynamic-local-import',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Use require() instead of import - might be traced differently by nft
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hello } = require('../lib/db-minimal');
    const message = hello();
    res.status(200).json({
      success: true,
      message,
      test: 'require-local',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hello } from '../lib/db-minimal';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const message = hello();
    res.status(200).json({
      success: true,
      message,
      test: 'lib-import-from-outside-api',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

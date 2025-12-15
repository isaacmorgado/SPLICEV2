import type { VercelRequest, VercelResponse } from '@vercel/node';
import { testHelper } from './test-helper';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const message = testHelper();
    res.status(200).json({
      success: true,
      message,
      test: 'same-level-import',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

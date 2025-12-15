import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSql } from './_shared/db-minimal';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = await getSql();
    const result = await sql`SELECT 1 as check`;
    res.status(200).json({
      success: true,
      message: 'Static import from _shared/db-minimal works!',
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

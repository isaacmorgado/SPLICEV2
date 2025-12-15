import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Try dynamic import of the db module to catch any errors
    const dbModule = await import('./_shared/db');
    const sql = await dbModule.getSql();
    const result = await sql`SELECT 1 as check`;
    res.status(200).json({
      success: true,
      message: 'Dynamic import from ./db works!',
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

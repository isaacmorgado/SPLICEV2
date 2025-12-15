import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Dynamic import the db module to test if it works
    const { sql } = await import('./lib/db');
    const result = await sql`SELECT 1 as check`;
    res.status(200).json({
      success: true,
      message: 'Dynamic import of lib/db works!',
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

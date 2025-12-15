import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Dynamic import of the full db module
    const db = await import('../lib/db.js');
    const sql = await db.getSql();

    // Test a simple query
    const result = await sql`SELECT NOW() as time, 'db-full-test' as source`;

    res.status(200).json({
      success: true,
      message: 'Full db.ts module works with dynamic import!',
      data: result[0],
      availableFunctions: Object.keys(db),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

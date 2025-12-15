import type { VercelRequest, VercelResponse } from '@vercel/node';

// Inline getSql to test if the pattern works when not importing from lib/db
type SqlFunction = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

let _sql: SqlFunction | null = null;

async function getSql(): Promise<SqlFunction> {
  if (!_sql) {
    const { neon } = await import('@neondatabase/serverless');
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = neon(url) as unknown as SqlFunction;
  }
  return _sql;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = await getSql();
    const result = await sql`SELECT 1 as check`;
    res.status(200).json({
      success: true,
      message: 'Inline getSql pattern works!',
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

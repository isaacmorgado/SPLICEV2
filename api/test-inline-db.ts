import type { VercelRequest, VercelResponse } from '@vercel/node';

// Inline getSql factory - this pattern works because it's all in one file
async function getSql() {
  const { neon } = await import('@neondatabase/serverless');
  return neon(process.env.DATABASE_URL!);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = await getSql();
    const result = await sql`SELECT NOW() as time, 1 + 1 as math`;

    res.status(200).json({
      success: true,
      message: 'Inline database pattern works!',
      data: result[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

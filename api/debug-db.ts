import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Try importing neon dynamically
    const neonModule = await import('@neondatabase/serverless');
    const neon = neonModule.neon;

    // Test the connection
    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql`SELECT 1 as check`;

    res.status(200).json({
      success: true,
      message: 'Neon connection successful',
      hasDbUrl: !!process.env.DATABASE_URL,
      queryResult: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

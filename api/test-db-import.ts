import type { VercelRequest, VercelResponse } from '@vercel/node';

// Diagnostic: try to import and report exactly what fails
let importError: Error | null = null;
let sqlFn: ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) | null =
  null;

try {
  // This top-level await will show us exactly where it fails
  const db = await import('./lib/db');
  sqlFn = db.sql;
} catch (e) {
  importError = e instanceof Error ? e : new Error(String(e));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (importError) {
    res.status(500).json({
      success: false,
      phase: 'import',
      error: importError.message,
      stack: importError.stack,
    });
    return;
  }

  try {
    const result = await sqlFn!`SELECT 1 as check`;
    res.status(200).json({
      success: true,
      message: 'Import and query of lib/db works!',
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      phase: 'query',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

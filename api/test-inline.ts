import type { VercelRequest, VercelResponse } from '@vercel/node';

// Inline function - no imports from local files
function hello(): string {
  return 'Hello from inline function!';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const message = hello();
    res.status(200).json({
      success: true,
      message,
      test: 'inline-works',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

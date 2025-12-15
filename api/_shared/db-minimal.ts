// Minimal db module for testing
type SqlFunction = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

let _sql: SqlFunction | null = null;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const neonModule = require('@neondatabase/serverless');

export async function getSql(): Promise<SqlFunction> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = neonModule.neon(url) as unknown as SqlFunction;
  }
  return _sql;
}

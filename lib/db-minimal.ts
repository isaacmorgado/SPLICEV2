// Ultra minimal module - no external imports
// Located outside api/ directory so Vercel bundles it properly
export function hello(): string {
  return 'Hello from lib/db-minimal!';
}

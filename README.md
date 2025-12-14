# Splice

AI-powered automation plugin for Adobe Premiere Pro.

## Features

- **Timeline Analysis** - Analyze clips, tracks, and duration
- **Auto-Cut Silence** - Automatically remove silent sections
- **AI Color Match** - Match color grading across clips using AI

## Requirements

- Adobe Premiere Pro 25.6.0 or later
- Node.js 20.0.0 or later
- UXP Developer Tool

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## UXP Commands

```bash
# Start UXP service
uxp service start

# Load plugin in Premiere Pro
npm run uxp:load

# Watch for changes
npm run uxp:watch

# Reload plugin
npm run uxp:reload

# Package for distribution
npm run uxp:package
```

## Project Structure

```
splice/
├── src/
│   ├── api/          # Premiere Pro & AI APIs
│   ├── components/   # UI components
│   ├── lib/          # Utilities
│   └── types/        # TypeScript types
├── public/           # Static assets
├── tests/            # Test files
├── dist/             # Build output
└── manifest.json     # UXP plugin manifest
```

## License

MIT

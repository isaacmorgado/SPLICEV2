# Splice

AI-powered automation plugin for Adobe Premiere Pro that streamlines video editing with intelligent audio analysis, transcription, and automated timeline editing.

## Features

### Core Capabilities

- **Smart Silence Detection** - Automatically detect and remove awkward pauses using AI-powered analysis
- **Take Detection & Selection** - Identify repeated takes and select the best version
- **Voice Isolation** - Remove background noise for cleaner transcription and analysis
- **AI Transcription** - Generate accurate word-level timestamps with OpenAI Whisper
- **Automated Timeline Editing** - Apply edits directly to your Premiere Pro timeline

### Subscription Tiers

- **Free**: 10 minutes/month - Try core features
- **Pro**: 120 minutes/month ($14.99) - For regular creators
- **Studio**: 500 minutes/month ($39.99) - For professionals

## Requirements

- **Adobe Premiere Pro** 25.6.0 or later
- **Node.js** 20.0.0 or later
- **UXP Developer Tool** (for development)

## Installation

### For Users

1. Download the latest `.ccx` package from releases
2. Open Adobe Premiere Pro
3. Go to Window > Extensions > Manage Extensions
4. Click "Install" and select the `.ccx` file
5. The Splice panel will appear in Window > Extensions > Splice

### For Developers

```bash
# Clone the repository
git clone https://github.com/yourusername/splice.git
cd splice

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Build the plugin
npm run build

# Load in Premiere Pro
npm run uxp:load
```

## Quick Start

1. **Sign Up/Login** - Create an account or sign in
2. **Open a Sequence** - Select your timeline in Premiere Pro
3. **Choose a Feature**:
   - Click "Detect Silence" to find awkward pauses
   - Click "Find Takes" to identify repeated phrases
   - Click "Transcribe" for word-level timestamps
4. **Review & Apply** - Preview results and apply to timeline

## Documentation

- [API Reference](docs/API.md) - Backend endpoints and integration
- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Development Guide](docs/DEVELOPMENT.md) - Setup, testing, and deployment

## Tech Stack

### Frontend (UXP Plugin)
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **Spectrum Web Components** - Adobe's design system
- **UXP APIs** - Premiere Pro integration

### Backend (Vercel Serverless)
- **Vercel Functions** - Serverless API endpoints
- **Neon Postgres** - Serverless database
- **Stripe** - Subscription management
- **OpenAI Whisper** - Transcription
- **ElevenLabs** - Voice isolation (optional)

## Development

```bash
# Development server
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Format code
npm run format
```

## UXP Development

```bash
# Start UXP service (one time)
uxp service start

# Watch for changes and reload
npm run uxp:watch

# Manually reload plugin
npm run uxp:reload

# Package for distribution
npm run uxp:package
```

## Project Structure

```
splice/
├── api/                    # Vercel serverless functions
│   ├── _lib/              # Shared utilities (auth, db, stripe)
│   ├── ai/                # AI service endpoints
│   ├── auth/              # Authentication endpoints
│   ├── stripe/            # Payment endpoints
│   ├── subscription/      # Usage & tier management
│   └── health.ts          # Health check endpoint
├── db/
│   └── schema.sql         # Database schema
├── src/
│   ├── api/               # API clients (Premiere, Whisper, etc)
│   ├── components/        # UI components
│   ├── config/            # Configuration constants
│   ├── lib/               # Utilities (errors, logger, storage)
│   ├── services/          # Core business logic
│   └── types/             # TypeScript type definitions
├── tests/                 # Vitest test files
├── dist/                  # Build output
├── manifest.json          # UXP plugin manifest
└── vercel.json           # Vercel deployment config
```

## Environment Variables

### Backend (.env)
```env
# Database
DATABASE_URL=postgresql://...

# Authentication
JWT_SECRET=your-secret-key

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STUDIO_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI Services
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=... (optional)
GEMINI_API_KEY=... (optional)
```

## Error Handling

Splice uses a comprehensive error system with typed error codes:

```typescript
// Example error usage
import { SpliceError, SpliceErrorCode } from '@/lib/errors';

throw new SpliceError(
  SpliceErrorCode.AUDIO_NO_SEQUENCE,
  'No active sequence found'
);
```

Error categories:
- **AME_xxx** - Adobe Media Encoder errors
- **AUD_xxx** - Audio extraction errors
- **CHK_xxx** - Audio chunking errors
- **PPR_xxx** - Premiere Pro API errors
- **TRS_xxx** - Transcription errors
- **SIL_xxx** - Silence detection errors
- **TKE_xxx** - Take detection errors
- **NET_xxx** - Network/API errors

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test

# Run tests once
npm run test:run
```

## Deployment

### Backend (Vercel)
```bash
# Deploy to production
vercel --prod

# Deploy preview
vercel
```

### Plugin (Adobe Exchange)
```bash
# Package plugin
npm run uxp:package

# Output: release/Splice.ccx
```

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/splice/issues)
- **Email**: support@splice.app (for Studio tier)

## Roadmap

- [ ] Multi-language support for transcription
- [ ] Custom silence threshold adjustment
- [ ] Batch processing for multiple sequences
- [ ] Export markers for manual review
- [ ] Integration with additional AI providers
- [ ] Real-time collaboration features

## Acknowledgments

- Adobe UXP team for excellent documentation
- OpenAI for Whisper API
- Vercel for serverless infrastructure
- The Premiere Pro plugin community

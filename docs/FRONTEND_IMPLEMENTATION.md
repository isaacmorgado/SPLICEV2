# Frontend Implementation - Splice Premiere Pro Plugin

## Overview

The Splice frontend is a **UXP (Adobe Unified Extensibility Platform) plugin** built with TypeScript and Adobe Spectrum Web Components. It integrates directly into Adobe Premiere Pro as a panel extension and communicates with the Vercel serverless backend for authentication, subscription management, and AI services.

## Technology Stack

### Core Technologies
- **Platform**: Adobe UXP (Unified Extensibility Platform)
- **Language**: TypeScript
- **Build Tool**: Vite 6.0
- **UI Framework**: Adobe Spectrum Web Components
- **API Communication**: Native Fetch API with JWT authentication

### UI Components
- `@spectrum-web-components/theme` - Theme provider
- `@spectrum-web-components/button` - CTA and action buttons
- `@spectrum-web-components/textfield` - Form inputs
- `@spectrum-web-components/action-button` - Tab navigation and toggles

## Architecture

### Component Structure

```
src/
├── components/
│   ├── App.ts              # Main application container
│   └── AuthPanel.ts        # NEW: Authentication UI (login/register)
├── api/
│   ├── backend-client.ts   # Backend API client with auth
│   ├── premiere.ts         # Premiere Pro API wrapper
│   └── ai-services.ts      # AI service integrations
├── services/
│   ├── subscription.ts     # Subscription management
│   ├── take-detector.ts    # Take detection logic
│   └── service-status.ts   # Service health monitoring
└── lib/
    ├── secure-storage.ts   # Secure credential storage
    ├── logger.ts           # Logging system
    └── errors.ts           # Error handling
```

## Authentication Flow

### Initial Load
```
User opens plugin
    ↓
App.init() checks secureStorage.isAuthenticated()
    ↓
    ├─ NOT authenticated → Show AuthPanel
    │   ↓
    │   User login/register
    │   ↓
    │   BackendClient stores JWT tokens
    │   ↓
    │   Callback → loadMainApp()
    │
    └─ Authenticated → loadMainApp()
        ↓
        Load subscription status
        ↓
        Render main UI
```

### Token Management
- **Access Token**: Stored in UXP secure storage, expires after 1 hour
- **Refresh Token**: Stored in UXP secure storage, lasts 30 days
- **Auto-Refresh**: Tokens are automatically refreshed when within 5 minutes of expiration
- **Retry Logic**: Failed requests with 401 status trigger automatic token refresh and retry

### Authentication Components

#### AuthPanel.ts
**Purpose**: Handles user authentication before main app access

**Features**:
- Tab-based UI for Login/Register
- Email validation
- Password confirmation (register mode)
- Service health indicator
- Error display
- Loading states

**Methods**:
- `render()` - Renders authentication UI
- `handleSubmit()` - Validates and submits credentials
- `checkServiceHealth()` - Displays backend availability
- `showError()` / `hideError()` - Error state management

#### App.ts Updates
**New Properties**:
- `authPanel: AuthPanel | null` - Auth panel instance
- `isAuthenticated: boolean` - Authentication state

**New Methods**:
- `showAuthPanel()` - Displays authentication UI
- `loadMainApp()` - Loads main app after authentication
- `handleLogout()` - Logs out user and shows auth panel

## Backend Integration

### API Client (backend-client.ts)

The `BackendClient` class handles all communication with the Vercel backend:

```typescript
// Base configuration
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000/api';

// Key methods
await backendClient.login(email, password)      // Authenticate user
await backendClient.register(email, password)   // Create new account
await backendClient.logout()                    // Clear credentials
await backendClient.checkHealth()               // Health check
await backendClient.getSubscriptionStatus()     // Get tier & usage
await backendClient.createCheckoutSession(tier) // Stripe checkout
```

### API Endpoints Used

#### Authentication
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login existing user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify` - Verify token validity

#### Subscription
- `GET /api/subscription/status` - Get current tier and usage
- `GET /api/subscription/usage` - Get detailed usage history
- `GET /api/subscription/tiers` - Get available subscription tiers

#### Stripe
- `POST /api/stripe/create-checkout` - Create checkout session for upgrade
- `POST /api/stripe/create-portal` - Open Stripe billing portal

#### AI Services
- `POST /api/ai/transcribe` - Transcribe audio with Whisper
- `POST /api/ai/analyze-takes` - Detect repeated takes with LLM
- `POST /api/ai/isolate-audio` - Voice isolation (ElevenLabs/Modal)

#### Health
- `GET /api/health` - Backend health check

## UI Screens

### Authentication Screen
**When**: User not authenticated or after logout

**Features**:
- Login/Register tabs
- Email and password fields
- Password confirmation (register only)
- Service status indicator
- Error messages
- Benefits list (register mode)

### Home Tab
**Features**:
- Project information display
- Timeline statistics (clips, duration, tracks)
- Quick action buttons (Analyze Timeline, Quick Silence Cut)
- Usage bar (minutes used/limit)

### Silence Tab
**Features**:
- Silence threshold slider
- Voice isolation toggle
- Preset management
- Detect Silence button
- Results display (silent sections, time to remove)
- Apply Cuts button

### Takes Tab
**Features**:
- Transcribe button
- Transcript display
- Analyze Takes button
- Take groups with color coding
- Selection strategy (Best Only, All Takes, Manual)
- Take preview
- Apply Takes button

### Settings Tab
**Features**:
- Subscription status card with tier badge
- Usage progress bar
- Upgrade buttons (Free tier)
- Manage Subscription button (Paid tiers)
- Refresh subscription button
- LLM provider selection (OpenAI/Gemini)
- **Logout button** (NEW)
- Debug panel with logs
- Tier comparison info

## State Management

### App State Interface
```typescript
interface AppState {
  activeTab: 'home' | 'silence' | 'takes' | 'settings';
  projectName: string;
  projectPath: string;
  clipCount: number;
  duration: number;
  tracks: number;
  status: string;
  isProcessing: boolean;
  // Silence tab
  silenceThreshold: number;
  useVoiceIsolation: boolean;
  silentSections: number;
  timeToRemove: number;
  selectedPresetId: string | null;
  availablePresets: SilenceDetectionPreset[];
  // Takes tab
  transcript: string;
  takes: NormalizedTake[];
  takeGroups: TakeGroup[];
  takeSelectionStrategy: TakeSelectionStrategy;
  takePreview: TakePreview | null;
  // Settings tab
  tier: TierId;
  minutesUsed: number;
  minutesLimit: number;
  subscriptionStatus: 'active' | 'canceled' | 'expired';
  periodEnd: Date | null;
  // Debug
  debugPanelExpanded: boolean;
  debugFilterLevel: LogLevel;
}
```

## Secure Storage

### What Gets Stored
- **Access Token**: JWT for API authentication
- **Refresh Token**: Long-lived token for renewal
- **Token Expiry**: Timestamp for auto-refresh logic
- **API Keys**: User's own API keys (BYOK feature)
- **LLM Preference**: Preferred LLM provider (OpenAI/Gemini)

### Storage Methods
```typescript
// Authentication
await secureStorage.getAuthToken()
await secureStorage.setAuthToken(token, expiresAt)
await secureStorage.clearAuthToken()

// Refresh tokens
await secureStorage.getRefreshToken()
await secureStorage.setRefreshToken(token)

// User preferences
await secureStorage.getPreferredLLM()
await secureStorage.setPreferredLLM('openai' | 'gemini')

// BYOK API keys
await secureStorage.getApiKey('openai')
await secureStorage.setApiKey('openai', key)

// Auth state
await secureStorage.isAuthenticated()
await secureStorage.needsTokenRefresh()

// Clear all
await secureStorage.clearAll()
```

## Environment Configuration

### Development (.env)
```env
# Backend API URL
VITE_BACKEND_URL=http://localhost:3000/api

# Optional: OpenAI API key for direct calls
OPENAI_API_KEY=your_key_here
```

### Production (.env)
```env
# Production backend
VITE_BACKEND_URL=https://splice-dusky.vercel.app/api
```

## Build & Deployment

### Development
```bash
# Start dev server (hot reload)
npm run dev

# Watch mode with UXP reload
npm run uxp:watch
```

### Production Build
```bash
# Build plugin
npm run build

# Output: dist/
# - index.html
# - main.js (bundled app)
# - manifest.json (UXP manifest)
```

### Package for Distribution
```bash
# Create .ccx package
npm run uxp:package

# Output: release/Splice.ccx
```

### Install in Premiere Pro
```bash
# Load plugin (development)
npm run uxp:load

# Reload plugin after changes
npm run uxp:reload
```

## Error Handling

### Error Display
- **Authentication Errors**: Displayed in red error box in AuthPanel
- **API Errors**: Shown in status bar at bottom of main UI
- **Network Errors**: Service status indicator shows red/degraded
- **Validation Errors**: Inline validation in forms

### Error Types
```typescript
// From lib/errors.ts
throw new SpliceError(
  SpliceErrorCode.NETWORK_TIMEOUT,
  'Connection timeout'
);

// Handled in UI
private handleError(error: unknown, fallbackMessage: string): void {
  if (isSpliceError(error)) {
    displayMessage = error.toDisplayString();
  } else {
    displayMessage = fallbackMessage;
  }
  this.setStatus(displayMessage, false);
}
```

## Service Status Monitoring

### Health Check
- Runs on app initialization (background)
- Updates service status indicator in header
- Shows color-coded status:
  - **Green**: Healthy
  - **Orange**: Degraded
  - **Red**: Unavailable

### Status Service
```typescript
// Update status
serviceStatus.markAvailable('backend', responseTime)
serviceStatus.markDegraded('backend', 'Slow response')
serviceStatus.markUnavailable('backend', 'Connection failed')

// Get status
const status = serviceStatus.getStatus()
const color = serviceStatus.getStatusColor()
const message = serviceStatus.getStatusMessage()

// Subscribe to changes
serviceStatus.subscribe(() => {
  this.updateServiceStatusIndicator();
});
```

## User Flow Examples

### First Time User
1. Opens plugin in Premiere Pro
2. Sees AuthPanel with "Register" tab
3. Enters email and password
4. Creates account (auto-login)
5. Main app loads with Free tier (10 min/month)
6. Can immediately use core features

### Returning User
1. Opens plugin
2. Auto-authenticates with stored tokens
3. Main app loads directly
4. If token expired, auto-refreshes in background

### Subscription Upgrade
1. User in Settings tab sees usage near limit
2. Clicks "Pro - $14.99/mo" button
3. Opens Stripe checkout in browser
4. Completes payment
5. Returns to Premiere Pro
6. Plugin detects tier change (polling)
7. UI updates to show Pro tier and 120 min limit

### Logout & Re-login
1. User clicks "Logout" in Settings
2. All credentials cleared from secure storage
3. AuthPanel shows Login tab
4. User enters credentials
5. Re-authenticates and returns to main app

## Performance Optimizations

### Token Caching
- Tokens stored in UXP secure storage (fast)
- No need to re-authenticate on each API call
- Auto-refresh prevents unnecessary re-login

### Subscription Caching
- Subscription status cached in service
- Only refreshed when explicitly requested
- Reduces API calls during normal usage

### Lazy Loading
- Auth panel only created when needed
- Main app components only loaded after auth
- Service status updated in background

### Debouncing
- Silence threshold slider debounced
- Prevents excessive re-renders

## Security Considerations

### Token Storage
- JWT tokens stored in UXP secure storage (encrypted)
- Never exposed in logs or UI
- Cleared on logout

### HTTPS Only
- Production backend requires HTTPS
- Network requests validated

### Input Validation
- Email format validation
- Password minimum length (8 chars)
- Password confirmation match

### Error Messages
- No sensitive data in error messages
- Generic messages for auth failures
- Detailed logs only in debug mode

## Testing

### Type Checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
npm run lint:fix
```

### Manual Testing Checklist
- [ ] Login with valid credentials
- [ ] Register new account
- [ ] Invalid email shows error
- [ ] Password mismatch shows error
- [ ] Logout clears credentials
- [ ] Token auto-refresh on expiry
- [ ] Service health indicator updates
- [ ] Subscription status loads correctly
- [ ] Upgrade flow works
- [ ] All tabs render without errors

## Known Limitations

### UXP Constraints
- No React or Vue (vanilla TS only)
- Limited CSS support (Spectrum Web Components)
- No hot module reload (must rebuild)
- No browser DevTools (UXP Developer Tool required)

### API Constraints
- Rate limiting: 100 req/10s per IP, 1000 req/hr per user
- Token expiry: Access token 1hr, refresh token 30 days
- Usage limits based on tier

## Future Enhancements

### Short Term
- [ ] Remember me checkbox
- [ ] Password reset flow
- [ ] Email verification
- [ ] Profile management (change password)

### Medium Term
- [ ] Offline mode with cached data
- [ ] Multi-language support
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcuts

### Long Term
- [ ] Collaborative editing
- [ ] Real-time usage tracking
- [ ] Advanced analytics dashboard
- [ ] Plugin marketplace integration

## Troubleshooting

### Plugin Not Loading
1. Check UXP Developer Tool is running
2. Verify manifest.json in dist/
3. Check Premiere Pro version >= 25.6.0

### Authentication Fails
1. Check VITE_BACKEND_URL in .env
2. Verify backend is running (health check)
3. Check network connectivity
4. Review logs in debug panel

### Token Refresh Fails
1. Clear secure storage: `secureStorage.clearAll()`
2. Re-login
3. Check refresh token hasn't expired (30 days)

### Build Fails
1. Clear node_modules and reinstall
2. Check TypeScript version
3. Verify all imports are correct

## Support

For issues or questions:
- **Documentation**: `/docs` folder
- **GitHub Issues**: Report bugs
- **Logs**: Use debug panel in Settings tab

---

**Last Updated**: December 15, 2024
**Version**: 1.0.0
**Production API**: https://splice-dusky.vercel.app/api

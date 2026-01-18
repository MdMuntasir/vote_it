# Vote System

A real-time polling application built on Cloudflare's edge infrastructure with Firebase authentication.

## Architecture

```
Cloudflare Pages (Frontend)
         ↓
Cloudflare Workers (API)
         ↓
    ┌────┴────┐
    ↓         ↓
Durable    Cloudflare D1
Objects    (Metadata + Backup)
(Vote Engine)
    ↑
Firebase Auth (Google OAuth)
```

## Features

- **Google OAuth** - Sign in with Google via Firebase
- **Create Polls** - Authenticated users can create polls with multiple options
- **Real-time Voting** - Vote counts update instantly via Durable Objects
- **Duplicate Prevention** - One vote per browser (IP + fingerprint)
- **Edge Performance** - All components run on Cloudflare's global network

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Cloudflare Pages (HTML/CSS/JS) |
| API | Cloudflare Workers (TypeScript) |
| Vote Engine | Durable Objects |
| Database | Cloudflare D1 (SQLite) |
| Auth | Firebase Auth (Google OAuth) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- Cloudflare account (Workers Paid plan for Durable Objects)
- Firebase project with Google OAuth enabled

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create D1 database (local)

```bash
wrangler d1 create vote-db
```

Update `wrangler.toml` with the returned database ID.

### 3. Apply database schema

```bash
wrangler d1 execute vote-db --local --file=schema.sql
```

### 4. Configure Firebase

Edit `frontend/env.js` with your Firebase credentials:

```javascript
window.ENV = {
  API_URL: 'http://localhost:8787/api',
  FIREBASE_API_KEY: 'your-api-key',
  FIREBASE_AUTH_DOMAIN: 'your-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'your-project-id',
};
```

Update `wrangler.toml`:

```toml
[vars]
FIREBASE_PROJECT_ID = "your-project-id"
```

### 5. Start development server

```bash
wrangler dev
```

### 6. Serve frontend (separate terminal)

```bash
cd frontend
npx serve .
```

Or open `frontend/index.html` directly in your browser.

## Deployment

### Deploy Workers API

```bash
# Create production D1 database
wrangler d1 create vote-db

# Apply schema to production
wrangler d1 execute vote-db --file=schema.sql

# Deploy worker
wrangler deploy
```

### Deploy Frontend (Cloudflare Pages)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages
2. Create a new project and connect your Git repository
3. Configure build settings:
   - Build output directory: `frontend`
   - No build command required (static files)
4. Add environment variables or update `frontend/env.js` with production values

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/google` | No | Authenticate with Firebase ID token |
| GET | `/api/polls` | No | List all polls |
| POST | `/api/polls` | Yes | Create a new poll |
| GET | `/api/polls/:id` | No | Get poll with live vote counts |
| POST | `/api/polls/:id/vote` | No | Submit a vote |
| GET | `/api/health` | No | Health check |

## Project Structure

```
vote-system/
├── frontend/                 # Cloudflare Pages
│   ├── index.html           # Main HTML
│   ├── styles.css           # Styling
│   ├── app.js               # Application logic
│   ├── env.js               # Environment config
│   └── _headers             # Security headers
├── src/                     # Cloudflare Workers
│   ├── index.ts             # Entry point
│   ├── router.ts            # Route matching
│   ├── types.ts             # TypeScript types
│   ├── handlers/
│   │   ├── auth.ts          # Auth handlers
│   │   ├── polls.ts         # Poll handlers
│   │   └── votes.ts         # Vote handlers
│   ├── middleware/
│   │   └── auth.ts          # Auth middleware
│   ├── durable-objects/
│   │   └── VoteEngine.ts    # Vote Durable Object
│   └── utils/
│       ├── db.ts            # Database helpers
│       ├── firebase.ts      # Firebase verification
│       └── response.ts      # Response utilities
├── schema.sql               # D1 database schema
├── wrangler.toml            # Workers configuration
├── package.json             # Dependencies
└── tsconfig.json            # TypeScript config
```

## How Voting Works

1. User clicks a poll option
2. Frontend generates browser fingerprint (FingerprintJS)
3. Vote request sent to Workers API
4. Worker routes to poll's Durable Object
5. DO checks for duplicate (IP + fingerprint)
6. If valid, DO updates in-memory counts
7. DO syncs to D1 every 5 seconds (backup)
8. Response returns updated vote counts

## Environment Variables

### Workers (`wrangler.toml`)

```toml
[vars]
FIREBASE_PROJECT_ID = "your-firebase-project-id"

[[d1_databases]]
binding = "DB"
database_name = "vote-db"
database_id = "your-database-id"
```

### Frontend (`frontend/env.js`)

```javascript
window.ENV = {
  API_URL: 'https://vote-system-api.your-subdomain.workers.dev/api',
  FIREBASE_API_KEY: 'your-api-key',
  FIREBASE_AUTH_DOMAIN: 'your-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'your-project-id',
};
```

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Authentication → Sign-in method → Google
4. Add your domains to authorized domains:
   - `localhost` (for development)
   - Your Cloudflare Pages domain
5. Copy config values to `frontend/env.js`

## License

MIT

# StudiQ

AI-powered personalized tutoring platform. Teachers create adaptive lessons for students using Claude AI, track progress, and get actionable insights.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS |
| Backend | Hono (Node.js), Drizzle ORM |
| Database | PostgreSQL (Supabase) |
| AI | Claude API (Anthropic) |
| Auth | Supabase Auth, JWT, HttpOnly cookies |
| Infra | pnpm monorepo, Turborepo, Vercel |

## Architecture

```
apps/
  web/          Next.js frontend (16 pages, i18n, RTL)
  api/          Hono REST API (9 route modules, ~45 endpoints)
packages/
  types/        Shared TypeScript types
infrastructure/
  supabase/     Database migrations & seed
```

**Key design decisions:**
- Monorepo with workspace dependencies (`@studiq/*`)
- TypeScript end-to-end with Zod validation on every endpoint
- API runs as Next.js API route in production (single deployment)
- Lazy DB initialization with Proxy pattern for serverless compatibility
- Dual-cookie auth: HttpOnly for tokens, readable cookie for middleware routing

## Features

**Teacher Dashboard**
- Student roster with AI-generated summaries
- One-click AI lesson generation with full student context
- Difficulty report tracking and review
- Feedback loop that refines future AI lessons
- Invite system (token-based student onboarding)

**Student Dashboard**
- Personalized lessons with homework and practice tasks
- Mark tasks as completed or failed (failures trigger AI analysis)
- Progress reports with AI recommendations
- Topic-based onboarding

**AI Integration**
- Lesson generation using student profile, weak/strong topics, learning style, and teacher feedback
- Automatic difficulty tagging on task failures
- Student AI profile that evolves with each interaction
- Period reports with completion analysis and recommendations

**Security**
- HttpOnly cookie authentication (XSS-resistant)
- CSRF protection via custom header validation
- Rate limiting on authentication endpoints
- Security headers (HSTS, X-Frame-Options, CSP, X-Content-Type-Options)
- Input validation with Zod on every endpoint
- SQL injection protection via Drizzle ORM parameterized queries
- Role-based access control (teacher/student)

**i18n**
- Full Hebrew and English support
- RTL layout support
- Cookie-based locale persistence

## Getting Started

### Prerequisites
- Node.js >= 22
- pnpm >= 10
- PostgreSQL database (or Supabase project)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Fill in: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

# Run database migrations
pnpm --filter @studiq/api db:migrate

# Start development servers
pnpm dev
```

The app runs at `http://localhost:3002` (web) and `http://localhost:3003` (API).

> **Note on `DATABASE_URL`:** Supabase's direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only. On IPv4 networks (most home ISPs and many CI providers), use the **Transaction Pooler** instead: `postgres.<ref>:<pw>@aws-<region>.pooler.supabase.com:6543/postgres`. The DB client already disables prepared statements when a pooler URL is detected.

### Testing

```bash
# Run all tests
pnpm test

# Run with watch mode
pnpm --filter @studiq/api test:watch

# Run with coverage
pnpm test:coverage
```

## Deployment

Deployed on Vercel with automatic deployments on push to `main`.

The API runs as a Next.js API route (`/api/*`) for a single-origin deployment.

## License

Private project.

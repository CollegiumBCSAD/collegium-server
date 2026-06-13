# Collegium – Backend Server: AI Context Reference

> **Purpose:** This file is a ground-truth reference for any AI assistant working inside this repository. Read this before touching any file. Do not hallucinate features, tables, or endpoints that are not described here.

---

## What Is Collegium?

Collegium is a university-verified collegiate esports management platform for the **Philippine collegiate circuit**. It is built as a **Progressive Web App (PWA)** and serves four game titles:

| Title | Abbreviation | Genre | Data Source |
|---|---|---|---|
| Valorant | VAL | FPS (PC) | Riot Games REST API (automated) |
| League of Legends | LOL | MOBA (PC) | Riot Games REST API (automated) |
| Mobile Legends: Bang Bang | MLBB | MOBA (Mobile) | Two-step peer-confirmation (manual) |
| Call of Duty: Mobile | CODM | FPS (Mobile) | Two-step peer-confirmation (manual) |

Access is restricted to users with verified **`.edu.ph` institutional email addresses** only.

---

## Repository Role

This repo is the **backend server**. It is one of two repos:

| Repo | Role |
|---|---|
| `collegium-frontend` | Next.js v14 frontend (separate repo) |
| `collegium-server` ← **this repo** | NestJS backend API server |

The frontend communicates with this server via REST API. Real-time features (War Room chat, live bracket updates) are handled via Redis pub/sub, which this server manages.

---

## Tech Stack

### Backend Framework
- **NestJS v10** with **Node.js v20**
- Modular, domain-driven architecture — each feature domain is its own NestJS module

### Language
- **TypeScript v5** — strict typing is enforced throughout, especially on Riot Games API response schemas and VCS data structures

### Database
- **PostgreSQL v16** — primary relational database
- **Prisma ORM v5** — schema migrations, type-safe queries, and database access

### Caching & Real-Time
- **Redis v7** — pub/sub layer for:
  - War Room chat
  - Scrim coordination channel messages
  - Live tournament bracket updates
  - Riot Games API response caching

### Authentication
- **Auth.js (NextAuth.js) v5** — institutional email verification, `.edu.ph` domain enforcement, JWT/session management

### Infrastructure (local dev)
- **Docker Compose** — runs PostgreSQL and Redis locally (already configured in this repo)

### Cloud Deployment Targets
- Frontend: Vercel (separate repo)
- PostgreSQL: Railway or Supabase
- Redis: Upstash

---

## NestJS Module Architecture

Each module maps to a core feature domain. Do not merge or rename these without good reason.

```
src/
├── auth/              # Authentication, .edu.ph domain check, JWT, RBAC guards
├── users/             # User account management (profiles, role assignment)
├── universities/      # University registration, Glicko-2 rating storage
├── scrims/            # Peer-to-Peer Scrim Board (post, request, approve, chat)
├── tournaments/       # Tournament creation, bracket generation, result propagation
├── war-room/          # Auto-generated private chatrooms per tournament match
├── match-logging/     # Hybrid match data pipeline (API + peer-verification)
├── ranking/           # Glicko-2 VCS engine, Bottom-Up Aggregation, rating periods
├── portfolios/        # Dual-layer athlete portfolio (Practice + Tournament stats)
├── community/         # News hub, community posts (Non-Athlete accounts)
└── prisma/            # PrismaService (singleton database client)
```

---

## Role-Based Access Control (RBAC)

There are exactly **four user roles**. Guards must enforce these at the route level.

| Role | Enum Value | Description |
|---|---|---|
| Athlete | `ATHLETE` | Registered varsity player |
| Coach / Manager | `COACH` | University team manager; can post scrims, submit match data |
| Non-Athlete | `NON_ATHLETE` | Community/spectator account; read-only access to public data |
| System Administrator | `ADMIN` | Full platform access |

Role is stored on the `users` table as an enum. RBAC is enforced via NestJS guards using decorators.

---

## Database Schema (Prisma)

These are the canonical tables. Do not add or rename fields without updating the Prisma schema.

### `users`
| Field | Type | Notes |
|---|---|---|
| `id` | `String` (UUID v4) | Primary key |
| `email` | `String` | Must be a `.edu.ph` address |
| `role` | `Enum` | `ATHLETE \| COACH \| NON_ATHLETE \| ADMIN` |
| `university_id` | `String` (UUID v4) | FK → `university.id` |
| `display_name` | `String` | Publicly visible name |
| `created_at` | `DateTime` | ISO 8601 |

### `university`
| Field | Type | Notes |
|---|---|---|
| `id` | `String` (UUID v4) | Primary key |
| `name` | `String` | Full university name |
| `domain` | `String` | e.g. `umak.edu.ph` |
| `glicko2_rating` | `Float` | Current Glicko-2 rating (Bottom-Up Aggregated) |
| `glicko2_rd` | `Float` | Rating Deviation |
| `glicko2_sigma` | `Float` | Volatility |
| `created_at` | `DateTime` | ISO 8601 |

### `match`
| Field | Type | Notes |
|---|---|---|
| `id` | `String` (UUID v4) | Primary key |
| `tournament_id` | `String?` (UUID v4) | FK → tournament; `null` if scrim |
| `title` | `Enum` | `VALORANT \| LOL \| MLBB \| CODM` |
| `match_mode` | `Enum` | `TOURNAMENT \| SCRIM` |
| `winner_university_id` | `String` (UUID v4) | FK → `university.id` |
| `loser_university_id` | `String` (UUID v4) | FK → `university.id` |
| `is_verified` | `Boolean` | `true` only after both parties confirm |
| `played_at` | `DateTime` | ISO 8601 |

### `player_stat`
| Field | Type | Notes |
|---|---|---|
| `id` | `String` (UUID v4) | Primary key |
| `match_id` | `String` (UUID v4) | FK → `match.id` |
| `user_id` | `String` (UUID v4) | FK → `users.id` |
| `kills` | `Int?` | Null in Scrim Mode |
| `deaths` | `Int?` | Null in Scrim Mode |
| `assists` | `Int?` | Null in Scrim Mode |
| `objective_score` | `Float?` | Title-specific; null in Scrim Mode |
| `vcs_score` | `Float` | Computed Varsity Contribution Score |
| `data_source` | `Enum` | `API \| PEER_VERIFIED` |

---

## Core Business Logic

### Match Modes

**Scrim Mode** (`match_mode = SCRIM`)
- Only `win/loss` outcome and match completion status are recorded
- KDA and individual stats are **intentionally excluded** — do not add them here
- Contributes to Practice VCS only

**Tournament Mode** (`match_mode = TOURNAMENT`)
- Full individual stats are captured per player
- For `VALORANT` and `LOL`: stats are pulled automatically from the Riot Games API
- For `MLBB` and `CODM`: stats are submitted via the peer-confirmation protocol
- Contributes to Tournament VCS (weighted by Tournament Multiplier)

---

### Varsity Contribution Score (VCS)

The VCS is the composite performance metric per player per match. It has two modes:

#### Practice VCS
- Inputs: scrim completion rate, opponent diversity, win/loss consistency
- No KDA data — excluded by design
- Used for the "Practice Reliability" dimension of the athlete portfolio

#### Tournament VCS
- Inputs: kills, deaths, assists, objective_score (role-specific), win/loss
- Weighted by **Tournament Multiplier (TM ≥ 1.5x)**
- Genre-specific role weights apply (FPS weights differ from MOBA weights)
- Used for the "Peak Performance" dimension of the athlete portfolio

---

### Glicko-2 Dynamic Ranking Algorithm

Each player (and by aggregation, each university) has three Glicko-2 parameters:

| Parameter | Symbol | Meaning |
|---|---|---|
| Rating | `r` | Estimated skill level |
| Rating Deviation | `RD` | Uncertainty in the rating |
| Volatility | `σ` | Expected fluctuation in performance over time |

**Key behaviors:**
- `RD` decreases as a player accumulates verified match history
- `RD` increases during inactivity (e.g., semester breaks) — this is intentional
- `σ` distinguishes genuinely inconsistent performers from seasonally inactive players
- Rating updates happen in **batch at the end of each rating period** (one academic semester), not after each individual match

**Do not implement continuous per-match Glicko-2 updates.** The batch-period model is a core architectural decision.

---

### Bottom-Up Aggregation Model

University-wide Glicko-2 ratings are **not** computed from team match outcomes directly. Instead:

1. Individual player VCS scores are computed per rating period
2. VCS scores are aggregated across all registered players per university per title
3. Genre-specific weights are applied (FPS vs MOBA)
4. The aggregated value feeds into the Glicko-2 parameter update for the university
5. University `glicko2_rating`, `glicko2_rd`, and `glicko2_sigma` are updated in the `university` table

This means a university's ranking is a **direct function of its registered athletes' verified on-platform performance**, not external records.

---

## Riot Games API Integration

- Used for `VALORANT` and `LOL` in `TOURNAMENT` mode only
- Trigger: when a tournament match is confirmed by the tournament organizer
- Flow:
  1. Platform receives match confirmation with a Riot match ID
  2. Backend dispatches authenticated request to Riot Games REST API
  3. Response (JSON payload) is parsed for: KDA ratios, objective participation, role-specific metrics
  4. Data is normalized to the `player_stat` schema
  5. Records are queued for the next rating period batch
- API responses should be **cached in Redis** to avoid redundant calls
- API keys must be stored as environment variables — never hardcoded

---

## Two-Step Peer-Confirmation Protocol (Mobile Titles)

Used for `MLBB` and `CODM` — these titles have no public API.

1. **Step 1 – Submission:** Winning team's `COACH` uploads a timestamped scoreboard screenshot and submits match stats
2. **Step 2 – Verification:** Opposing team's `COACH` independently views the submission and confirms or disputes the result
3. Data is only written to `player_stat` and `match` (with `is_verified = true`) after **both** parties have acted
4. Disputed matches must surface to `ADMIN` for resolution

---

## Scrim Board Pipeline

```
POST /scrims          → Coach posts availability slot
GET  /scrims          → List available slots (filterable by title, rank band)
POST /scrims/:id/request  → Opposing coach submits a scrim request
POST /scrims/:id/approve  → Home coach approves the request
  └─ Side effect: private scrim chat channel created in Redis
POST /scrims/:id/result   → Either coach submits win/loss outcome
POST /scrims/:id/confirm  → Opposing coach confirms result
  └─ Side effect: Scrim Mode match record written to DB (no KDA)
```

---

## Tournament Module Pipeline

```
POST /tournaments              → Admin/Coach creates tournament
POST /tournaments/:id/register → University registers team
POST /tournaments/:id/bracket  → Generate bracket (single-elim or round-robin)
GET  /tournaments/:id/bracket  → View current bracket state
POST /tournaments/:id/matches/:matchId/confirm → Confirm match result
  └─ Side effects:
       - War Room chatroom instantiated (Redis)
       - For VAL/LOL: Riot API fetch triggered
       - For MLBB/CODM: peer-confirmation request created
POST /tournaments/:id/matches/:matchId/close   → Close match, propagate to ranking engine
```

---

## War Room

- A **private, temporary, role-restricted** chatroom
- Created automatically when a tournament match is confirmed
- Access: Tournament Organizer + the two University Coaches of matched teams only
- Backed by Redis pub/sub channels
- Automatically deactivated and archived when the match closes and results propagate
- Do not expose War Room channels to Athlete or Non-Athlete roles

---

## Environment Variables Required

```env
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# Riot Games API
RIOT_API_KEY=...

# Auth
NEXTAUTH_SECRET=...
AUTH_URL=...

# App
NODE_ENV=development | production
```

Never commit real values. Use `.env.example` as the template.

---

## Docker Compose (Local Dev)

The `docker-compose.yml` in this repo spins up:
- **PostgreSQL v16** on port `5432`
- **Redis v7** on port `6379`

Run with:
```bash
docker compose up -d
```

Then run Prisma migrations:
```bash
npx prisma migrate dev
```

---

## What This Server Does NOT Do

- It does not serve the frontend — that is the separate Next.js repo
- It does not manage `.edu.ph` email sending directly — Auth.js handles verification tokens
- It does not store raw screenshot files — only the confirmation status and extracted stat data
- It does not compute Glicko-2 after every single match — updates are batched per rating period (one semester)
- It does not expose scrim or tournament stats from non-verified matches (`is_verified = false` records are excluded from all ranking computations)

---

## Naming Conventions

| Thing | Convention |
|---|---|
| NestJS modules | `camelCase` folder names matching the domain |
| Prisma models | `PascalCase` |
| Prisma fields | `snake_case` |
| API routes | `kebab-case` REST paths |
| TypeScript types/interfaces | `PascalCase` |
| Enums | `SCREAMING_SNAKE_CASE` |
| Environment variables | `SCREAMING_SNAKE_CASE` |

---


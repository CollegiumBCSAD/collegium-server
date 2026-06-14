# Collegium – Backend Server: Development Reference

> **Purpose:** Ground-truth reference for development of the Collegium backend server.
> This file reflects both the thesis specification and actual architectural decisions made during development.
> When in conflict, **the thesis takes priority**. Deviations are explicitly noted.

---

## What Is Collegium?

Collegium is a university-verified collegiate esports management platform for the **Philippine collegiate circuit**. It is built as a **Progressive Web App (PWA)** and serves four game titles:

| Title | Abbreviation | Genre | Data Source | Status |
|---|---|---|---|---|
| League of Legends | LOL | MOBA (PC) | Riot Games REST API (automated) | ✅ Active — dev key works |
| Valorant | VALORANT | FPS (PC) | Riot Games REST API (automated) | ⏳ Deferred — requires production key |
| Mobile Legends: Bang Bang | MLBB | MOBA (Mobile) | Two-step peer-confirmation (manual) | ⏳ Deferred |
| Call of Duty: Mobile | CODM | FPS (Mobile) | Two-step peer-confirmation (manual) | ⏳ Deferred |

> **Current scope:** LoL only. Valorant, MLBB, and CODM are architecturally supported
> but deferred until Riot production key is obtained. Do not implement Valorant mock
> or MLBB/CODM peer-confirmation until core features are complete and Riot application is submitted.

Access is restricted to users with verified **`.edu.ph` institutional email addresses** only.

---

## Repository Role

| Repo | Role |
|---|---|
| `collegium-client` | Next.js v14 frontend (separate repo) |
| `collegium-server` ← **this repo** | NestJS backend API server |

---

## Tech Stack

Version is subjected to changes.

| Layer | Technology | Version |
|---|---|---|
| Framework | NestJS | v10 |
| Runtime | Node.js | v20 |
| Language | TypeScript | v5 |
| Database | PostgreSQL | v16 |
| ORM | Prisma | v5 (with pg adapter) |
| Cache / Pub-Sub | Redis | v7 |
| Auth | Auth.js (NextAuth.js) | v5 |
| HTTP Logging | Morgan | latest |
| HTTP Client | Axios | latest |
| Password Hashing | bcrypt | latest |
| Validation | class-validator + class-transformer | latest |


### Local Dev Infrastructure (Docker Compose)
- PostgreSQL on port `5432` (container: `collegium-db`)
- Redis on port `6379`

### Cloud Deployment Targets
- PostgreSQL: Railway or Supabase
- Redis: Upstash
- Frontend: Vercel (separate repo)

---

## NestJS Module Architecture

```
src/
├── auth/              # .edu.ph enforcement, JWT, RBAC guards, Google OAuth
├── universities/      # University registration, Glicko-2 rating storage
├── tournaments/       # Tournament creation, bracket generation, result propagation
├── match-logging/     # Hybrid match data pipeline (LoL API for now)
│   ├── fixtures/      # sample-lol-match.json for dev/testing
│   ├── interfaces/    # LolParticipant, NormalizedParticipant, VcsResult, MatchParser
│   └── parsers/       # LolParser, ParserFactory (ValorantParser deferred)
├── ranking/           # Glicko-2 VCS engine, Bottom-Up Aggregation, rating periods
└── prisma/            # PrismaService singleton (global module)
```

### Deferred Modules (post Riot production key)
```
├── users/             # User profile management
├── scrims/            # Peer-to-Peer Scrim Board
├── war-room/          # Auto-generated private chatrooms
├── portfolios/        # Dual-layer athlete portfolio
└── community/         # News hub, community posts
```

---

## Role-Based Access Control (RBAC)

Exactly **four user roles** as specified in the thesis:

| Role | Enum Value | Description |
|---|---|---|
| Athlete | `ATHLETE` | Registered varsity player |
| Coach / Manager | `COACH` | University team manager; posts scrims, submits match data |
| Non-Athlete | `NON_ATHLETE` | Community/spectator; read-only access to public data |
| System Administrator | `ADMIN` | Full platform access |

### Implementation
- JWT guard applied **globally** in `main.ts` — all routes protected by default
- `@Public()` decorator marks routes that skip auth (login, register)
- `@Roles()` decorator restricts routes to specific role(s)
- Role embedded in JWT payload, validated on every request via `JwtStrategy`

---

## Database Schema (Prisma)

### Naming Convention
- Prisma **models**: `PascalCase`
- Prisma **fields**: `snake_case` — matches thesis data dictionary spec
- **Deviation from Prisma default camelCase** — intentional

### Current Schema

```prisma
enum Role {
  ATHLETE
  COACH
  NON_ATHLETE
  ADMIN
}

enum AccountStatus {
  PENDING
  ACTIVE
  REJECTED
  SUSPENDED
}

enum GameTitle {
  VALORANT
  LOL
  MLBB
  CODM
}

enum MatchMode {
  TOURNAMENT
  SCRIM
}

enum DataSource {
  API
  PEER_VERIFIED
}

model University {
  id             String   @id @default(uuid())
  name           String
  domain         String   @unique
  glicko2_rating Float    @default(1500)
  glicko2_rd     Float    @default(350)
  glicko2_sigma  Float    @default(0.06)
  created_at     DateTime @default(now())

  users          User[]
  won_matches    Match[]  @relation("WinnerUniversity")
  lost_matches   Match[]  @relation("LoserUniversity")
}

model User {
  id            String        @id @default(uuid())
  email         String        @unique
  password      String?
  role          Role          @default(ATHLETE)
  status        AccountStatus @default(ACTIVE)
  display_name  String
  university_id String
  university    University    @relation(fields: [university_id], references: [id])
  player_stats  PlayerStat[]
  created_at    DateTime      @default(now())
}

model Match {
  id                   String    @id @default(uuid())
  tournament_id        String?
  title                GameTitle
  match_mode           MatchMode
  winner_university_id String
  loser_university_id  String
  is_verified          Boolean   @default(false)
  played_at            DateTime  @default(now())

  winner_university    University @relation("WinnerUniversity", fields: [winner_university_id], references: [id])
  loser_university     University @relation("LoserUniversity", fields: [loser_university_id], references: [id])
  player_stats         PlayerStat[]
}

model PlayerStat {
  id              String     @id @default(uuid())
  match_id        String
  user_id         String
  kills           Int?
  deaths          Int?
  assists         Int?
  objective_score Float?
  vcs_score       Float      @default(0)
  data_source     DataSource @default(API)
  created_at      DateTime   @default(now())

  match           Match      @relation(fields: [match_id], references: [id])
  user            User       @relation(fields: [user_id], references: [id])
}
```

### Glicko-2 Starting Values (standard Glickman 1995 spec)
- `glicko2_rating = 1500`
- `glicko2_rd = 350`
- `glicko2_sigma = 0.06`

---

## Authentication Design

### Registration Flow
```
User submits email + password + displayName + role
        ↓
Email checked for .edu.ph suffix → rejected if not
        ↓
Domain extracted → University table queried
→ Rejected if domain not registered
        ↓
Duplicate email check
        ↓
Password hashed (bcrypt, 10 salt rounds)
        ↓
User created with status = ACTIVE
        ↓
JWT issued immediately
```

### Google OAuth Flow
```
User clicks Google login
        ↓
Google returns profile + email
        ↓
Same .edu.ph + domain checks apply
        ↓
Auto-register if new (no password stored)
        ↓
JWT issued
```

### JWT Payload
```typescript
{
  sub: string;        // user ID
  email: string;
  role: Role;
  universityId: string;
}
```

### AccountStatus
- `ACTIVE` — default after .edu.ph check passes
- `SUSPENDED` — admin suspended; JWT immediately invalidated
- `PENDING` / `REJECTED` — reserved for future university onboarding

---

## Match Logging Architecture

### Current State (LoL only)
```
MatchLoggingService
        ↓
ParserFactory.getParser(GameTitle.LOL)
        ↓
LolParser — normalizes Riot API response to NormalizedParticipant[]
        ↓
VcsCalculatorService.calculateMatchVcs()
        ↓
PlayerStat records written via Prisma $transaction
```

### Match Modes

**Scrim Mode** (`match_mode = SCRIM`)
- Records win/loss + match completion only
- `kills`, `deaths`, `assists`, `objective_score` stored as `null`
- **Never populate KDA in Scrim Mode** — thesis requirement

**Tournament Mode** (`match_mode = TOURNAMENT`)
- Full individual stats per player
- LOL: automated via Riot Games API
- Contributes to Tournament VCS (TM ≥ 1.5x)

### objective_score for LoL
```
objective_score = (visionScore / teamTotalVision)
                + objectivesStolen
                + turretKills
                + inhibitorKills
```

### Riot API Access
| Title | Dev Key | Notes |
|---|---|---|
| League of Legends | ✅ Works | Region: sea.api.riotgames.com |
| Valorant | ❌ Blocked | Requires production key — deferred |

---

## VCS Formula

### Tournament VCS (LoL)
```
KDA Score       = (kills + assists) / max(deaths, 1)
Damage Score    = playerDamage / teamTotalDamage
Vision Score    = playerVision / teamTotalVision
Objective Score = turretKills + inhibitorKills + objectivesStolen

Raw Score  = KDA + Damage + Vision + Objective
Final VCS  = Raw Score × TM (1.5 for tournament, 1.0 for scrim)
```

### Practice VCS
- Inputs: scrim completion rate, opponent diversity, win/loss consistency
- No KDA — excluded by design
- Computed at end of rating period in batch, not per match

---

## Glicko-2 Ranking Engine

### Rules
1. **Batch updates only** — end of each rating period (one academic semester)
2. **Never update per-match** — core architectural decision from thesis
3. `RD` increases during inactivity — intentional
4. `σ` distinguishes inconsistent vs seasonally inactive players

### Bottom-Up Aggregation
```
Individual VCS scores (per rating period)
        ↓
Aggregated per university per title
        ↓
Genre weights applied (FPS vs MOBA)
        ↓
Glicko-2 university-level parameter update
        ↓
University glicko2_rating, glicko2_rd, glicko2_sigma updated
```

---

## API Routes

### Auth
```
POST   /auth/register              — Register (.edu.ph only)
POST   /auth/login                 — Login, returns JWT
GET    /auth/google                — Google OAuth redirect
GET    /auth/google/callback       — Google OAuth callback
PATCH  /auth/users/:id/status      — Admin: suspend/activate user
```

### Match Logging
```
POST   /match-logging/log/:title/:matchId?mode=TOURNAMENT  — Log a match
GET    /match-logging/stats/:matchId                       — Get match stats
```

### Universities
```
POST   /universities               — Admin: register university
GET    /universities               — List all + leaderboard standings
GET    /universities/:id           — University profile + Glicko-2 stats
```

### Tournaments
```
POST   /tournaments                          — Admin/Coach: create tournament
POST   /tournaments/:id/register             — University registers team
POST   /tournaments/:id/bracket              — Generate bracket
GET    /tournaments/:id/bracket              — View bracket
POST   /tournaments/:id/matches/:mid/confirm — Confirm match → Riot API triggered
POST   /tournaments/:id/matches/:mid/close   — Close match → ranking engine
```

### Ranking
```
POST   /ranking/compute            — Admin: trigger Glicko-2 batch computation
GET    /ranking/leaderboard        — University standings
GET    /ranking/players/:id        — Player Glicko-2 + VCS history
```

---

## Environment Variables

```env
DATABASE_URL=postgresql://collegium_user:collegium_password@localhost:5432/collegium_dev
REDIS_URL=redis://localhost:6379
RIOT_API_KEY=RGAPI-...
JWT_SECRET=your_secret_here
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback
PORT=5000
NODE_ENV=development
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| NestJS module folders | `kebab-case` | `match-logging/` |
| Prisma models | `PascalCase` | `University`, `PlayerStat` |
| Prisma fields | `snake_case` | `university_id`, `created_at` |
| TypeScript interfaces | `PascalCase` | `NormalizedParticipant` |
| Enums | `SCREAMING_SNAKE_CASE` | `PEER_VERIFIED` |
| API routes | `kebab-case` | `/match-logging/log` |
| Environment variables | `SCREAMING_SNAKE_CASE` | `RIOT_API_KEY` |
| Service methods | `camelCase` | `logMatch()` |

---

## What This Server Does NOT Do

- Does not serve the frontend
- Does not compute Glicko-2 per-match — batch per semester only
- Does not store raw screenshot files
- Does not expose stats from unverified matches (`is_verified = false` excluded from ranking)
- Does not populate KDA in Scrim Mode — ever

---

## Build Progress

| Module | Status | Notes |
|---|---|---|
| `prisma/` | ✅ Done | PrismaService, pg adapter, global module |
| `auth/` | ✅ Done | .edu.ph, JWT, Google OAuth, RBAC |
| `match-logging/` | ✅ Done | LoL pipeline, VCS calculator, parser factory |
| `universities/` | ⬜ Next | Admin registration + leaderboard |
| `tournaments/` | ⬜ Next | Bracket engine + match confirmation + Riot API trigger |
| `ranking/` | ⬜ Next | Glicko-2 batch engine + Bottom-Up Aggregation |
| `users/` | ⏳ Deferred | After Riot key |
| `scrims/` | ⏳ Deferred | After Riot key |
| `war-room/` | ⏳ Deferred | After Riot key |
| `portfolios/` | ⏳ Deferred | After Riot key |
| `community/` | ⏳ Deferred | After Riot key |

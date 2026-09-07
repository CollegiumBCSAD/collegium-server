# Collegium – Backend Server: Development Reference

> **Purpose:** Ground-truth reference for development of the Collegium backend server.
> This file reflects both the thesis specification and actual architectural decisions made during development.
> When in conflict, **the thesis takes priority**. Deviations are explicitly noted.
>
> **Revision note (this update):** This revision supersedes the previous version of this file, which still
> described a **university-level** rating computed from a **Varsity Contribution Score (VCS)** aggregated
> bottom-up from individual player statistics, a semester-based rating calendar, and a flat "Tournament
> Multiplier (TM ≥ 1.5×)." That design was **removed** from the thesis (Chapters I and III) and is retained
> nowhere in the current specification. The current, locked design rates the **Team** directly under a
> persistent, event-driven Glicko-2 engine. See §6 for the full list of what changed and why.

---

## What Is Collegium?

Collegium is a university-verified collegiate esports management platform for the **Philippine collegiate
circuit**. It is built as a **Progressive Web App (PWA)** and serves four game titles:

| Title | Abbreviation | Genre | Data Source | Status |
|---|---|---|---|---|
| League of Legends | LOL | MOBA (PC) | Riot Games REST API (automated) | ✅ Active — dev key works |
| Valorant | VALORANT | FPS (PC) | Riot Games REST API (automated) | ✅ Active — mock data ready, production key pending |
| Mobile Legends: Bang Bang | MLBB | MOBA (Mobile) | Two-tier Organizer verification + EasyOCR fallback | ⏳ Deferred |
| Call of Duty: Mobile | CODM | FPS (Mobile) | Two-tier Organizer verification + EasyOCR fallback | ⏳ Deferred |

> **Current scope:** LoL & Valorant active (Valorant uses mock data as default). MLBB and CODM are deferred.
> The Riot Games REST API is a **prospective, supplementary** data source for LoL/Valorant contingent on a
> production key — it occupies the same pipeline position as an OCR extraction module (§5.4) and its absence
> changes no downstream behavior, since Organizer verification is what the platform's correctness actually
> depends on, not any particular extraction path.

Access is restricted to users with verified **`.edu.ph` institutional email addresses** — with one exception:
the **Tournament Organizer** role (§3) is deliberately **outside** the `.edu.ph` constraint, since organizers
are not necessarily affiliated with a university.

---

## Repository Role

| Repo | Role |
|---|---|
| `collegium-web` | Next.js v14 frontend (separate repo) |
| `collegium-server` ← **this repo** | NestJS backend API server |

---

## Tech Stack

Version is subject to change.

| Layer | Technology | Version |
|---|---|---|
| Framework | NestJS | v10 |
| Runtime | Node.js | v20 |
| Language | TypeScript | v5 |
| Database | PostgreSQL | v16 |
| ORM | Prisma | v5 (with pg adapter) |
| Cache / Pub-Sub | Redis | v7 |
| Auth | Auth.js (NextAuth.js) | v5 |
| OCR | EasyOCR (Python, invoked as a callable service) | — |
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
├── auth/              # .edu.ph enforcement (institutional tiers), JWT, RBAC guards, Google OAuth,
│                       # separate Organizer credential path (not .edu.ph-gated)
├── teams/             # Team registration, roster management, Glicko-2 rating storage (moved from
│                       # universities/ — see §6)
├── universities/      # University record (affiliation only — no longer holds rating fields)
├── organizer/         # Organizer registration/login, tournament proposal submission, team/bracket
│                       # management, match score reporting
├── tournaments/       # Tournament application/review lifecycle, bracket generation (5 formats),
│                       # roster locking, Event Weight assignment, result propagation
├── bracket/           # Bracket engine: Single Elimination, Double Elimination, Swiss, Round Robin,
│                       # Two-Stage (Group + Playoffs) generation and advancement
├── ranking/           # Glicko-2 engine, Event Weight application, RatingPeriodService, weekly RD
│                       # inactivity decay job (⬜ Next — see §7 build status)
├── match-logging/     # Hybrid match data pipeline — two-tier verification (manual + OCR-assisted),
│                       # forfeit and dispute handling
│   ├── fixtures/      # sample-lol-match.json, sample-valorant-match.json for dev/testing
│   ├── interfaces/    # LolParticipant, ValorantParticipant, NormalizedParticipant, per-title OCR
│                       # extraction interfaces
│   └── ocr/           # Per-title OCR extraction modules (Valorant, LoL, MLBB, CODM), each
│                       # encapsulating that title's ROI template and invoked via a common interface
├── scrims/            # Scrim Board — display-only Practice Record (win/loss + completion only,
│                       # unranked, never enters the rating pipeline)
├── war-room/           # Per-tournament chat (Redis Pub/Sub), membership + archive lifecycle
├── portfolios/        # Athlete/team portfolio — Peak Performance Score display (§4.4), match history
└── community/         # Public leaderboard, news hub, non-rated community features
```

> **Build status:** see §7. `ranking/`, `teams/`, `bracket/`, `war-room/`, and the OCR modules under
> `match-logging/ocr/` are specified here as the target architecture; as of the last verified pass against
> this repository, most of this tree is not yet merged — the live schema still reflects the pre-pivot design.
> Treat the module list above as the destination, not a claim about `git log`.

---

## Role-Based Access Control (RBAC)

Collegium enforces **four institutional user tiers**, gated by `.edu.ph` domain verification, **together with
a fifth, non-institutional Tournament Organizer role**:

| Role | Enum Value | `.edu.ph` Gated? | Description |
|---|---|---|---|
| Athlete | `ATHLETE` | Yes | Default role. Registers to a team roster, submits scrim results, views own portfolio. |
| Coach / Manager | `COACH` | Yes | Requires Admin approval. Manages roster, submits tournament registration, flags match disputes. |
| Non-Athlete (Community) | `NON_ATHLETE` | Yes | Read-only community access — public leaderboard, news hub, spectator views. |
| System Administrator | `ADMIN` | Yes | Approves Coach accounts, reviews tournament proposals, resolves disputes, manages platform data. |
| Tournament Organizer | `ORGANIZER` | **No** | Applies per-event through a dedicated, non-`.edu.ph` credential path (`/organizer/login`, `/organizer/register`). Every tournament proposal — not just first-time account provisioning — is reviewed and approved or rejected by an Admin (§3). |

> **Correction from the previous revision of this file:** earlier drafts (and Chapter I, prior to its own
> pending update) describe a flat four-tier RBAC. The Organizer role was added as a fifth, structurally
> distinct tier because it sits outside the `.edu.ph` institutional-verification boundary entirely — it is
> not a permission level within the four institutional tiers. Keep this file and Chapter I reconciled; the
> worklist (`claude/worklist-workload-distribution.md`) tracks this as an open item.

---

## §3. Tournament Application & Admin Approval

Tournament creation is a **gated, per-event submission workflow**, not self-service publishing, and applies
identically to every proposal regardless of whether the same Organizer has hosted an approved event before.

**Flow:**
1. An Organizer selects "Apply for Tournament" and submits event details (name, game title, bracket format
   request, `maxTeams`, description, rules) together with their organizer account information.
2. The proposal is created with `TournamentStatus.PENDING_REVIEW`.
3. A System Administrator reviews the submission individually in `/admin/tournaments`. The Admin may approve
   the requested bracket format or override it.
4. **Approved:** the tournament is published and opened for team registration.
5. **Rejected:** the Admin records a `rejectionReason`; the *same* `Tournament` record is returned to the
   applicant for revision and resubmission — it cycles back to `PENDING_REVIEW` rather than being recreated
   or discarded.
6. Only once a tournament is approved does team registration, roster verification, War Room instantiation,
   and bracket generation become available for that event.

**Tournament Mode is competitive-only.** Casual, unranked, or exhibition "showmatch" events — even if
bracketed for scheduling convenience — are out of scope for the Tournament Module and are not eligible for
Organizer-verified logging or Glicko-2 rating updates. This is enforced structurally at the Admin approval
gate, not as a downstream filter: an Organizer application is the only path into Tournament Mode, and Admin
review is where non-competitive events are declined. Practice activity of this kind belongs in Scrim Mode.

---

## §4. Match Logging & Rating Data Pipeline

### 4.1 Match Modes

**Scrim Mode** (`match_mode = SCRIM`)
- Records win/loss + match completion only.
- `kills`, `deaths`, `assists`, `objective_score` stored as `null`.
- **Never populate KDA in Scrim Mode** — thesis requirement.
- Never enters the rating pipeline. Written to a separate `ScrimResult` relation consumed only by the
  Practice Record display component.

**Tournament Mode** (`match_mode = TOURNAMENT`)
- Full individual stats per player, computed and surfaced on portfolios (never read by the rating engine —
  see §4.3).
- LOL: automated via Riot Games API where a production key exists; otherwise Organizer-verified manual/OCR
  entry, same as MLBB/CODM.
- Eligible to enter a rating period once Organizer-verified.

### 4.2 Two-Tier Match Result Verification (all four titles)

Uniform across Valorant, LoL, MLBB, and CODM:

1. **Primary tier — manual transcription.** The Organizer transcribes the confirmed result directly from the
   official in-game scoreboard into a structured entry form.
2. **Secondary tier — OCR-assisted entry.** Functions as an entry-speed accelerator, **not** an independent
   verification path. The Organizer uploads a screenshot of the end-of-game scoreboard; the system attempts
   extraction via EasyOCR against a fixed region-of-interest (ROI) template keyed to title and expected
   resolution:

   | Title | Expected Resolution |
   |---|---|
   | Valorant | 1920×1080 |
   | League of Legends | 1600×800 |
   | Mobile Legends: Bang Bang | 2048×900 |
   | Call of Duty: Mobile | 2048×900 |

   Extracted in-game names are resolved to registered athletes via **roster-constrained Levenshtein-distance
   fuzzy matching** — evaluated only against the two competing teams' locked tournament rosters, never the
   full user base, bounding both compute cost and misattribution risk.

3. **Silent fallback.** If the uploaded image's resolution or layout doesn't match the expected template, the
   module returns no result and the workflow falls back to the **blank manual-entry form with no surfaced
   error** — correctness depends on Organizer review, never on OCR extraction succeeding.
4. **Side-by-side verification modal.** In both tiers, the uploaded screenshot (where present) is displayed
   alongside the extracted or manually entered fields; the Organizer reviews and corrects before final
   confirmation. No result reaches the rating engine without this step.
5. **Riot API path.** For LoL/Valorant with a production key, automated retrieval occupies the same pipeline
   position as an OCR module and feeds the same Organizer review step before commit.

Each title's ROI coordinates, field ordering, and parsing rules are implemented as an independent module
under `match-logging/ocr/`, invoked through a common interface by the logging service.

### 4.3 Rating Engine Input — Outcome Exclusivity

The rating engine ingests **exclusively the ordinal match outcome** (win, loss, or forfeit) from
Organizer-verified Tournament Mode matches. Granular performance telemetry — KDA, damage share, vision
score, objective participation — is computed and displayed on athlete/team portfolios but is **never read by
the rating engine**. This is a deliberate architectural separation, not an oversight: it eliminates any path
by which statistical padding in an already-decided match could influence competitive standing. See §6 for
what this replaced.

### 4.4 Peak Performance Score (portfolio display only)

The per-title statistical formulas that previously fed the university-level VCS still exist, computed by
`VcsCalculatorService`, but are now display-only — surfaced on athlete/team portfolios as a **Peak
Performance Score** and never consumed by `ranking/`.

**LoL:**
```
objective_score = (visionScore / teamTotalVision)
                + objectivesStolen
                + turretKills
                + inhibitorKills

KDA Score       = (kills + assists) / max(deaths, 1)
Damage Score    = playerDamage / teamTotalDamage
Vision Score    = playerVision / teamTotalVision

Raw Score  = KDA Score + Damage Score + Vision Score + objective_score
```

**Valorant:**
```
KDA Score       = (kills + assists) / max(deaths, 1)
Combat Share    = combatScore / teamAvgCombatScore
Headshot Bonus  = headshotPct                     // 0.0 – 1.0
Objective Score = plants + defuses + firstBloods

Raw Score  = KDA Score + Combat Share + Headshot Bonus + Objective Score
```

**Practice VCS (Scrim Mode display):** scrim completion rate, opponent diversity, win/loss consistency — no
KDA, computed at end of rating period in batch, not per match. Also display-only.

> These formulas are retained exactly as previously specified; what changed is that their output no longer
> touches Glicko-2 (§6).

### 4.5 Forfeit Handling

Collegium recognizes no draw state; every confirmed tournament match resolves to exactly one win/loss pair.
A forfeit — Organizer-flagged, requiring no supporting screenshot — is scored **identically to a contested
result**: a standard win for the receiving team, loss for the forfeiting team. A `wasForfeit` boolean is
retained purely for audit/UI display and is **never read by the rating engine**.

### 4.6 Dispute Handling

A Coach/Manager may flag a confirmed match result to the Administrator for review, prior to that
tournament's rating period closing. Upon review, the Administrator may reopen and correct the match record;
normal rating computation then proceeds unaffected using the corrected result. Modeled as a `MatchDispute`
entity (§8), surfacing as pipeline Stage 6 in the data-pipeline table (§5.1) ahead of rating-period closure.
Post-closure correction requires recomputation from `RatingHistory` (§8) rather than a live edit, since the
affected rating period has already been committed.

---

## §5. Rating Engine — Persistent Team-Level Glicko-2

Full algorithm design, worked-example validation, and edge-case table live in
`claude/Collegium_Ch3_Glicko2_Algorithm_Design.md` and `claude/glicko2-design.md` in the project. Summary for
this reference:

### 5.1 Rated Entity & Granularity

- One Glicko-2 triple **(r, RD, σ)** per registered **team**, scoped to a single game title. A university
  fielding rosters in all four titles maintains four independent rating states — never aggregated into a
  composite institutional figure.
- **Persistent** — carried forward across every tournament the team enters; never reset per event or
  semester.
- **Mode-exclusive** — Scrim Mode never enters a rating period batch (§4.1).

### 5.2 Glicko-2 Starting Values & Constants

| Constant | Value | Notes |
|---|---|---|
| `glicko2_rating` (r₀) | 1500 | Glickman's spec |
| `glicko2_rd` (RD₀) | 350 | Glickman's spec |
| `glicko2_sigma` (σ₀) | 0.06 | Glickman's spec |
| τ | 0.5 | Glickman's worked-example value; acknowledged as pending backtesting (§9) |
| Convergence ε | 0.000001 | Glickman's spec |
| `RD_MIN` / `RD_MAX` | 30 / 350 | Collegium extension — defensive bounds |
| `EVENT_WEIGHT_MIN` / `MAX` | 1.0 / 2.0 | Collegium extension — safety rail on Admin/Organizer overrides |
| Inactivity constant `c` | 0.80 | Collegium extension — replaces σ in the decay formula (§5.5); calibrated so a team dormant ~1 academic year (N ≈ 6.08 periods) returns to RD_MAX |
| `RATING_PERIOD_EQUIVALENT_DAYS` | 60 | Collegium extension — ≈ one academic bimester |
| `DECAY_GRACE_DAYS` | **75** | Collegium extension — no decay accrues within this window; covers the documented ~60-day maximum ordinary inter-tournament gap plus a 15-day scheduling buffer (raised from an initial 30-day value once that value was found to over-penalize normal semester scheduling) |

**Fields live on `Team`, not `University`** (see §6, §8).

### 5.3 Rating Period Definition & Closure

> **Rating Period** = the complete set of Organizer-verified matches within a **single tournament**,
> processed as one batch update at closure — not a fixed calendar interval.

Closure triggers on exactly two conditions:
1. **Automatic** — Organizer confirmation of the tournament's final unresolved match (a champion is
   determined).
2. **Administrative** — manual closure by a System Administrator for a cancelled/abandoned event; only
   matches already confirmed at that point enter the batch.

Concurrent tournaments are independent rating periods, closed without reference to one another even where
they share participating teams — a deliberate relaxation of Glickman's single-global-period assumption.

**Simultaneity / order independence:** all teams in a period are updated against opponent ratings as they
stood **at period open**, never against already-mutated ratings from the same batch. `RatingPeriodService`
enforces this via an immutable pre-period snapshot of every involved team's (r, RD, σ) before computing any
update — verified by `__tests__/order-independence.spec.ts`, including a negative control against the naive
(non-snapshotted) approach. A rematch (bracket reset, recurring group/playoff pairing) contributes one term
per match, never collapsed into one opponent entry.

### 5.4 The Seven-Step Procedure

Implemented in `lib/glicko2.util.ts`. Notation follows Glickman (2013) exactly:

```
μ = (r − 1500) / 173.7178          φ = RD / 173.7178

Step 1: g(φⱼ) = 1 / sqrt(1 + 3φⱼ²/π²)
        E(μ,μⱼ,φⱼ) = 1 / (1 + exp(−g(φⱼ)·(μ − μⱼ)))

Step 2: v = [ Σⱼ g(φⱼ)²·E·(1−E) ]⁻¹

Step 3: Δ = v · Σⱼ g(φⱼ)·(sⱼ − E)         sⱼ = 1 win, 0 loss/forfeit-loss

Step 4: σ′ = root of f(x) = [eˣ(Δ² − φ² − v − eˣ)] / [2(φ² + v + eˣ)²] − (x − ln σ²)/τ²
        (Illinois/regula falsi, ε = 0.000001)

Step 5: φ* = sqrt(φ² + σ′²)

Step 6: φ′ = 1 / sqrt(1/φ*² + 1/v)
        μ′ = μ + φ′²·Σⱼ g(φⱼ)·(sⱼ − E)

Step 7: r′ = 173.7178·μ′ + 1500      RD′ = clamp(173.7178·φ′, RD_MIN, RD_MAX)
```

Validated against Glickman's own published worked example (r=1500, RD=200, σ=0.06 vs. 3 opponents, τ=0.5) to
within the source's own rounding precision — see `__tests__/glicko2.util.spec.ts`.

### 5.5 Event Weight (post-processing, not a Glicko-2 variable)

Applied **after** Steps 1–7 have produced r′, RD′, σ′ — scales only the rating delta:

```
raw_delta = r′ − r
r_final   = r + (raw_delta × EW)
RD_final  = RD′        // untouched
σ_final   = σ′         // untouched
```

| Tier | Unique teams at bracket lock | Event Weight |
|---|---|---|
| Small | < 8 | 1.0× |
| Medium | 8–15 | 1.25× |
| Large | ≥ 16 | 1.5× |

Tier is assigned from unique-team count at bracket lock (objective, deterministic). An Organizer/Admin may
override before lock, bounded to `[1.0, 2.0]`; the override **freezes at lock time** and is never
recomputed — a later change to the tier table cannot retroactively alter an already-closed tournament's
rating history. Isolating EW to the delta (rather than injecting it into Step 3, ahead of the volatility
solver) keeps RD/σ purely evidence-driven and avoids destabilizing Step 4's convergence guarantees.

> **Acknowledged gap:** Event Weight tiers are a reasoned engineering hypothesis, not an empirically
> validated or Glicko-2-specific literature-derived result. Backtesting against real bracket outcomes is
> future work (see §9).

### 5.6 RD Inactivity Decay (separate scheduled job)

Because rating periods are tournament-shaped, a team that enters **zero** tournaments would otherwise never
trigger RD growth. A **weekly scheduled job**, decoupled from tournament closure, recomputes RD as an
**absolute function of elapsed time** from an anchored value — not an incremental mutation:

```
n_eff = max(0, d − DECAY_GRACE_DAYS) / RATING_PERIOD_EQUIVALENT_DAYS     d = days since team's last rated match
φ_now = sqrt(φ_anchor² + n_eff · c²)
RD_now = clamp(173.7178 · φ_now, RD_MIN, RD_MAX)
```

- **`c` (0.80), not σ, drives this formula.** An earlier formulation substituted σ directly into the
  no-games update — numerically verified to be *inoperative at collegiate timescales* (a team at RD=80,
  dormant a full year, would gain only ~4 points of RD under a σ-driven formula; reaching RD_MAX would take
  roughly 176 calendar years). `c` is calibrated per Glickman's own 1995 precedent so that ~1 academic year
  of dormancy (N ≈ 365/60 ≈ 6.08 periods) returns a typical team (RD ≈ 80) to RD_MAX.
- **Anchored, not incremental** — RD is recomputed from a persisted `rd_anchor` + `last_rated_at`, so the job
  is **idempotent** (repeated/retried execution converges on the same value, no double-decay) and
  **cadence-independent** (weekly vs. fortnightly execution agree at any observation time).
- **RD-only** — rating and σ are never touched by this job, matching Glickman's own no-games case exactly.
- Job only writes a change once `elapsedPeriods ≥ DECAY_MIN_ELAPSED_PERIODS` (0.05) to avoid DB churn for
  recently-touched teams.

**Circuit-wide dormancy** (the whole circuit going dark for an offseason, not just one team) requires no
special-casing: Glicko-2's own attenuation function `g(φⱼ)` already discounts a result's evidentiary weight
by the opponent's uncertainty, so two mutually rusty teams playing each other simply teach the system less.
Ratings take the first several tournaments of a resumed season to firm back up rather than the first
tournament alone — an anticipated consequence of the existing design, not a gap requiring a fix.

### 5.7 Edge Cases

| Case | Behavior |
|---|---|
| New team, first tournament | r=1500, RD=350, σ=0.06; large first-tournament swings are expected/correct |
| Forfeit | Scored identically to a played WIN/LOSS; `wasForfeit` is display-only |
| Team withdraws before bracket pairing | No rating impact — no confirmed match ever existed |
| Bye awarded | No rating impact — a bye is not a game |
| Roster drops below 5 after lock | Flagged for Admin review, **not** auto-forfeited (§4.5, §10) |
| Team enters zero tournaments for a stretch | Not touched by any closure; picked up by §5.6's calendar job |
| Two teams linked directly and via a common opponent in one period | Handled correctly by the pre-period snapshot — order-invariant |
| Concurrent tournaments sharing participants | Each closure computed/applied independently, in real closure order |
| Disconnected match graph (regions that never play) | Acknowledged limitation shared with Elo-family systems generally |
| Extremely long win streak | RD floored at `RD_MIN` (30) |
| Extremely long inactivity | RD ceilinged at `RD_MAX` (350) — never more uncertain than a new team |
| Erroneous Organizer entry | Correctable by Admin pre-closure; post-closure requires recomputation from `RatingHistory` |

---

## §6. Summary of Changes From the Pre-Pivot Design

For any AI assistant or contributor comparing this file against an older version, a prior draft
(`_Chapters 13.docx.pdf`-era) and this repository's schema described:

| Removed | Replaced by |
|---|---|
| University-level rating (`glicko2_*` fields on `University`) | Team-level rating (`glicko2_*` fields on `Team`), scoped per game title |
| Varsity Contribution Score (VCS) feeding the rating via Bottom-Up Aggregation | Rating engine ingests only Organizer-verified WIN/LOSS/FORFEIT; VCS-style formulas retained as display-only "Peak Performance Score" (§4.4) |
| Semester-based, calendar-aligned rating periods | Event-driven rating periods — one per tournament, closed at champion determination (§5.3) |
| Flat Tournament Multiplier (TM ≥ 1.5×) | Tiered Event Weight (1.0×/1.25×/1.5×), applied post-computation to the rating delta only (§5.5) |
| Two-step peer-confirmation (competing coaches confirm each other) for MLBB/CODM | Two-tier Organizer verification: manual transcription, or OCR-assisted with silent fallback (§4.2) |
| One-time, account-level Organizer vetting | Per-tournament Admin review of every proposal, with reject → revise → resubmit on the same record (§3) |
| War Room: per-match, Coach-only, deactivated on match completion | War Room: per-tournament, Organizer + full verified roster, read-only archive on closure (§ below) |
| Four-tier RBAC | Four institutional tiers + a fifth, non-`.edu.ph` Organizer tier (§2) |

**War Room (current spec):** one room per **tournament** (not per match), created once team registration and
roster verification for that event have closed and **before** bracket generation. Membership is the
Organizer plus the **full verified roster** (Coach/Manager *and* registered Athletes) of every competing
team — not Coaches only. Persists through the tournament; on closure it transitions to a **read-only
archive**, remaining viewable by members rather than being deactivated/deleted.

---

## §7. Build Status (verify against `git log` before relying on this table)

| Area | State |
|---|---|
| Database schema | Pre-pivot as of the last verified check — `glicko2_*` still on `University`; no `Team`, `ORGANIZER`, or tournament-review fields yet |
| Rating engine (`lib/glicko2.util.ts`) | Written and unit-tested against Glickman's worked example; not yet wired to a live schema |
| `ranking/`, `teams/`, `organizer/`, `bracket/`, `war-room/` | Specified above; not yet merged |
| OCR | Standalone Python scripts (separate `collegium-ocr` repo) — not yet wrapped as a callable service |

Before writing code against this file, confirm current state against the actual `prisma/schema.prisma` and
module tree — this table is a snapshot, not a live status page.

---

## §8. Data Model (target schema — post-pivot)

Key entities and fields. UUID v4 primary keys, snake_case columns, Prisma ORM v5 conventions throughout.

```prisma
enum Role {
  ATHLETE
  COACH
  NON_ATHLETE
  ADMIN
  ORGANIZER
}

enum TournamentStatus {
  PENDING_REVIEW
  UPCOMING
  ONGOING
  COMPLETED
  REJECTED
  CANCELLED
}

enum BracketFormat {
  SINGLE_ELIM
  DOUBLE_ELIM
  SWISS
  ROUND_ROBIN
  TWO_STAGE
}

model Team {
  id              String   @id @default(uuid())
  university_id   String
  title           GameTitle
  glicko2_rating  Float    @default(1500)
  glicko2_rd      Float    @default(350)
  glicko2_sigma   Float    @default(0.06)
  rd_anchor       Float    @default(350)
  last_rated_at   DateTime?
  min_roster_size Int
  max_roster_size Int

  members         TeamMember[]
  ratingHistory   RatingHistory[]
}

model TeamMember { /* Athlete ↔ Team, one active role slot for LoL role-uniqueness (§10) */ }

model Tournament {
  id                    String            @id @default(uuid())
  organizer_id          String
  status                TournamentStatus  @default(PENDING_REVIEW)
  bracket_format        BracketFormat
  event_weight          Float?            // frozen at lock
  max_teams             Int
  rejection_reason      String?
  locked_at             DateTime?
  rating_period_closed_at DateTime?       // nullable — guards against double-closure
  reviewed_at           DateTime?

  roster                TournamentRoster[]
  matches               Match[]
  warRoom               WarRoom?
}

model TournamentRoster       { /* locked, verified roster snapshot per team per tournament */ }
model TournamentRosterMember { /* individual Athletes locked into a TournamentRoster */ }

model WarRoom {
  id             String   @id @default(uuid())
  tournament_id  String   @unique
  status         WarRoomStatus  // ACTIVE | ARCHIVED
  members        WarRoomMember[]
}
model WarRoomMember { /* Organizer + every User on a verified competing roster */ }

model Match {
  id                   String    @id @default(uuid())
  tournament_id        String?
  title                GameTitle
  match_mode           MatchMode // SCRIM | TOURNAMENT
  winner_team_id       String
  loser_team_id        String
  was_forfeit          Boolean   @default(false)
  is_verified          Boolean   @default(false)
  played_at            DateTime  @default(now())

  player_stats         PlayerStat[]
  dispute              MatchDispute?
}

model MatchDispute {
  id            String   @id @default(uuid())
  match_id      String   @unique
  flagged_by    String   // Coach/Manager user id
  reason        String
  resolved_by   String?  // Admin user id
  resolution    String?
  resolved_at   DateTime?
}

model RatingHistory {
  id                String   @id @default(uuid())
  team_id           String
  tournament_id     String
  rating_before     Float
  rd_before         Float
  sigma_before      Float
  rating_after      Float
  rd_after          Float
  sigma_after       Float
  raw_delta         Float
  event_weight      Float
  closed_at         DateTime @default(now())
}

model ScrimResult { /* display-only Practice Record — never read by ranking/ */ }

model PlayerStat {
  id              String     @id @default(uuid())
  match_id        String
  user_id         String
  kills           Int?
  deaths          Int?
  assists         Int?
  objective_score Float?
  peak_performance_score Float @default(0)   // renamed from vcs_score — display only
  data_source     DataSource @default(API)   // API | MANUAL | OCR
  created_at      DateTime   @default(now())
}
```

> This is a reference sketch, not the literal migration diff. Field-level ground truth is whatever
> `prisma/schema.prisma` and its migration history actually contain — reconcile before relying on exact
> names.

---

## §9. Acknowledged Parameter Gaps

Three parameter groups are reasoned engineering hypotheses, not empirically validated or literature-derived
values — stated explicitly rather than presented as settled fact:

| Parameter | Value | Validation pathway |
|---|---|---|
| Event Weight tiers | 1.0×/1.25×/1.5× at 8 and 16 entrants | Backtesting against completed Philippine collegiate brackets |
| τ | 0.5 | Sensitivity analysis across τ ∈ [0.3, 1.2] once sufficient match volume exists |
| `c`, `RATING_PERIOD_EQUIVALENT_DAYS`, `DECAY_GRACE_DAYS` | 0.80, 60, 75 | Recalibration against the empirical distribution of inter-tournament intervals post-pilot |

No Glicko-2-specific literature validating differential post-hoc event weighting was identified; the nearest
precedent (Lasek, Szlávik & Bhulai 2013; Hvattum & Arntzen 2010) is Elo/football, supporting the general
principle but not these specific multipliers.

---

## §10. Roster Size Limits (per title)

| Title | Minimum | Maximum | Basis |
|---|---|---|---|
| Valorant | 5 | 6 (5 starters + 1 sub) | UAAP Esports precedent; matches MPL-PH, CODM World Championship convention |
| Mobile Legends: Bang Bang | 5 | 6 | UAAP Esports precedent |
| Call of Duty: Mobile | 5 | 6 | CODM World Championship ruleset |
| League of Legends | 5 | 7 (5 starters + up to 2 subs) | Collegium design decision — no fixed PH collegiate precedent exists; the extra bench slot reflects LoL's five distinct, non-interchangeable positional roles, under which one floating substitute cannot cover more than one role at a time |

- A given Athlete may not hold more than one positional role on the same LoL roster simultaneously.
- Roster composition locks at **each tournament's registration close** (event-driven), not on a
  semester-wide basis.
- A Coach/Manager may not submit a team for bracket registration with fewer than 5 eligible Athletes at lock
  time. A team that drops below 5 **after** locking (e.g., academic dismissal) is flagged for Admin review
  rather than auto-scored as a forfeit — preserving the distinction between an involuntary eligibility lapse
  and an actual competitive no-show.
- `minRosterSize` / `maxRosterSize` are per-title constants on `Team` (§8), not a hardcoded global value.

---

## §11. Bracket Formats

Five supported formats, selected by the Organizer at proposal time and confirmed/overridden by Admin review:

| Format | Notes |
|---|---|
| Single Elimination | Standard knockout tree |
| Double Elimination | Winners/losers bracket with grand-final reset; a bracket reset contributes a **distinct** rating-period term, never collapsed with the original grand final |
| Swiss | Round-paired matchups by record |
| Round Robin | Full round-robin group table |
| Two-Stage (Group + Playoffs) | Group stage (Round Robin or Swiss) advancing to a Final Stage elimination bracket; rematches between group and playoff stages contribute distinct terms to the rating period |

Bracket generation and advancement logic lives in `bracket.service.ts`, invoked from `tournaments/` once a
proposal is approved and locked.

---

## Authentication Design

### Institutional Registration Flow
```
User submits email + password + displayName + role (ATHLETE | COACH | NON_ATHLETE)
        ↓
Email checked for .edu.ph suffix → rejected if not
        ↓
Domain extracted → University table queried → rejected if domain not registered
        ↓
Duplicate email check
        ↓
Password hashed (bcrypt, 10 salt rounds)
        ↓
User created with status = ACTIVE (COACH additionally requires Admin approval before elevated actions)
        ↓
JWT issued immediately
```

### Organizer Registration Flow (separate, non-`.edu.ph`)
```
Organizer submits email + password + organization name via /organizer/register
        ↓
No .edu.ph / University domain check
        ↓
Duplicate email check → password hashed → User created with role = ORGANIZER
        ↓
JWT issued — proposal-level Admin review (§3) happens per tournament, not at account creation
```

### Google OAuth Flow
```
User clicks Google login → Google returns profile + email
        ↓
Same .edu.ph + domain checks apply (institutional tiers only)
        ↓
Auto-register if new (no password stored) → JWT issued
```

### JWT Payload
```typescript
{
  sub: string;        // user ID
  email: string;
  role: Role;
  universityId?: string;  // absent for ORGANIZER
}
```

### AccountStatus
- `ACTIVE` — default after `.edu.ph`/domain checks pass (institutional tiers) or account creation (Organizer)
- `SUSPENDED` — Admin-suspended; JWT immediately invalidated
- `PENDING` / `REJECTED` — reserved for future university onboarding

---

## Environment Variables

| Variable | Description | Example / Default | Note |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://collegium_user:collegium_password@localhost:5432/collegium_dev?schema=public` | Matches database container configuration |
| `PORT` | Server listening port | `5000` | |
| `NODE_ENV` | Environment mode | `development` | |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` | |
| `JWT_SECRET` | Secret key for JWT signing | `your-secret-key` | `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | Token expiration | `7d` | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google OAuth | — | From Google Cloud Console |
| `RIOT_API_KEY` | Riot Games API Key | `RGAPI-...` | Dev keys expire in 24h; prospective/supplementary only (see top of file) |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` | |
| `OCR_SERVICE_URL` | Callable EasyOCR service endpoint | — | Not yet wired — see §7 |

---

## Coding Conventions

| Item | Convention |
|---|---|
| File naming | `kebab-case.service.ts`, `kebab-case.controller.ts` |
| Class naming | `PascalCase` |
| Enums | `SCREAMING_SNAKE_CASE` values |
| Branching | `main` (production), `dev` (active development) |
| Branch naming | `feat/`, `fix/`, `docs/`, `refactor/`, `chore/` |
| Commits | Conventional Commits — `<type>(<scope>): <description>`, imperative mood, no trailing period |
| Common scopes | `auth`, `teams`, `organizer`, `ranking`, `bracket`, `scrims`, `tournaments`, `war-room`, `prisma`, `redis`, `ci` |
| Pre-PR checks | `pnpm run lint`, `pnpm run format`, `pnpm run test` |
| PRs | Target `dev`; no direct pushes to `main` |

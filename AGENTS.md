# Collegium Server — Development Guidelines and Engineering Standards

This document outlines mandatory architectural patterns, coding conventions, and NestJS best practices for `collegium-server`.

All developers and automated agents must inspect the surrounding codebase conventions first and strictly adhere to these guidelines to ensure code quality, maintainability, and correctness.

---

## 1. Codebase Inspection Protocol

Before implementing features, modifying modules, or adding endpoints:
1. **Inspect existing conventions**: Look at how existing modules are structured (`src/teams/`, `src/tournaments/`, `src/auth/`) before adding a new one.
2. **Reuse established services**: Use `PrismaService` (`src/prisma/prisma.service.ts`) for all database access, `NotificationsService` (`src/notifications/notifications.service.ts`) to create a persisted notification for a user. Note: `src/universities/glicko.service.ts` is a superseded per-match implementation (retained temporarily for tests, not to be called by active workflows); production rating computation belongs under `ranking/`. Do not duplicate query logic or reimplement algorithms that already exist.
3. **One module per domain**: `auth`, `teams`, `tournaments`, `scrims`, `universities`, `notifications`, `coach` (Coach/Manager tier: approval queue, coach invitations, practice schedules, unranked scrim Practice Records, team audit log; `TeamAuthorityService` decides who may register a team — the coach, or the captain when the team has none), and target domains (`ranking`, `organizer`, `bracket`, `war-room`, `portfolios`, `community`). Match verification uses Two-Tier Organizer verification (manual transcription + EasyOCR fallback; Riot Games API is prospective/supplementary only). A new domain concept gets a new module, not a folder bolted onto an existing one.

---

## 2. Module Structure

Every module follows the same file layout:
```
src/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.service.spec.ts
  dto/
    <name>.dto.ts
```
Modules with auth-adjacent concerns add `decorators/`, `guards/`, `strategies/`, `interfaces/` (see `src/auth/` as the reference example).

- **Controllers stay thin**: route + guard/role declarations + delegate to the service. No Prisma calls, no business logic in a controller method.
- **Services own logic**: all Prisma queries, validation beyond DTO shape, and domain rules (e.g. `TeamsService.createTeam` rejecting unregistered-institution captains) live in the service.
- **Constructor injection only**: `constructor(private readonly prisma: PrismaService) {}` — never instantiate `PrismaClient` directly inside a service (the seed script is the one sanctioned exception, since it runs outside Nest's DI container).

---

## 3. DTOs and Validation — Critical

The app runs a **global `ValidationPipe`** in `main.ts`:
```ts
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
```
`whitelist: true` means **any DTO property without a `class-validator` decorator is silently stripped**, and `forbidNonWhitelisted: true` turns that into a 400 rejecting the entire request. A DTO class with no decorators at all effectively blocks every field.

**This has already caused a real, hard-to-notice production bug**: `CreateTeamDto`/`JoinTeamDto` had zero decorators and `POST /teams` + `POST /teams/:id/join` 400'd on every real request until caught by a live end-to-end test, not by `build`/`lint`/unit tests (all of which passed the whole time).

**Rule**: every field on every DTO must have at least one `class-validator` decorator, even if it feels obvious (`@IsString()`, `@IsNotEmpty()`, `@IsEnum(...)`, `@IsOptional()` for optional fields). Reference `src/scrims/dto/scrims.dto.ts` as the correct pattern. `class-validator`/`class-transformer` are already dependencies — use them, don't write manual validation in the service.

**Verification**: when adding or touching a DTO, hit the real endpoint (curl or Swagger at `/api-docs`) with a realistic payload, not just `pnpm build`. TypeScript compiling clean says nothing about whether `class-validator` will accept the request at runtime.

---

## 4. Prisma & Database Access

- All access goes through the injected `PrismaService` — never a second `PrismaClient` instance inside application code.
- Use `include`/`select` deliberately and only for what the caller needs (e.g. `TeamsService.findOne()` includes `members`; don't over-fetch relations "just in case").
- **Migrations are always named**: `nix develop --command npx prisma migrate dev --name <descriptive_name>`.
- After any `schema.prisma` change, run `nix develop --command npx prisma generate` before building — stale generated types are a common source of confusing build errors.
- `prisma migrate dev` requires an interactive TTY and will refuse to run non-interactively (e.g. from an agent or CI) whenever the change is destructive, such as removing an enum value. In that situation, hand-author the migration SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` following Prisma's own generated pattern (see `20260817092342_remove_coach_role` for the enum-value-removal pattern) and apply it non-interactively with `nix develop --command npx prisma migrate deploy`.
- The seed script (`prisma/seed.ts`) is destructive by design (wipes all tables before reseeding) and is the one place a raw `PrismaClient` + `PrismaPg` adapter is constructed by hand, mirroring `PrismaService`'s constructor.

---

## Rating Engine — Binding Rules

Authoritative spec: `claude_collegium-server-reference-v2.md` §5.
Where any other file in this repo disagrees with it, that file is stale.
Report the conflict; do not follow it.

BUILD STATE: the Glicko-2 kernel is written and validated. The closure
path, Event Weight application, and decay job are NOT built yet. Absence
of this code is expected — do not treat it as missing and do not
improvise a replacement.

Rated entity
- One (r, RD, sigma) triple per TEAM, scoped to one gameTitle.
- Never rate a University. Never aggregate teams into an institutional
  figure. A university fielding four titles has four independent
  ratings; two teams in the same title have two independent ratings.

Rating input
- Ordinal outcome only: win / loss / forfeit, from Organizer-verified
  TOURNAMENT-mode matches.
- KDA, damage, vision, objective score are portfolio display data and
  are NEVER read by the rating engine.
- Scrim Mode never enters the rating pipeline.
- No draw state exists. Every match resolves to one win/loss pair.
- A forfeit scores identically to a played result. `wasForfeit` is
  display/audit only and is never read by the rating math.

When ratings update
- A rating period = all Organizer-verified matches in ONE tournament,
  applied as a single batch at tournament closure.
- NEVER update a rating on match confirmation. Per-match sequential
  updating is order-dependent and is the exact anti-pattern
  `order-independence.spec.ts` exists to reject.
- All teams in a period update against an immutable pre-period snapshot
  of every participant's (r, RD, sigma), never against ratings already
  mutated within the same batch.
- A rematch contributes one term per match; never collapse rematches
  into a single opponent entry.
- Closure is guarded on `rating_period_closed_at` for idempotency.

Do not modify
- `lib/glicko2.util.ts` and its spec files. The kernel is validated
  against Glickman's published worked example and that validation is
  thesis evidence. Do not rewrite, refactor, reformat, or "improve" it.

Event Weight
- Post-processing on the rating delta ONLY:
  r_final = r + (r' - r) * EW. RD and sigma are untouched.
- Never inject EW into Step 3 — it destabilizes the volatility solver
  and corrupts RD as an evidence-driven quantity.
- Tiers by unique teams at bracket lock: <8 = 1.0x, 8-15 = 1.25x,
  >=16 = 1.5x. Admin/Organizer override bounded to [1.0, 2.0].
- Frozen at bracket lock; never recomputed for a closed tournament.

RD inactivity decay (separate scheduled job, weekly)
- Constants: c = 0.80, RATING_PERIOD_EQUIVALENT_DAYS = 60,
  DECAY_GRACE_DAYS = 75, RD clamped to [30, 350].
- DECAY_GRACE_DAYS is 75, not 30. Any file stating 30 is a superseded
  draft — 30 was found to over-penalize ordinary 60-day collegiate
  tournament spacing.
- Recompute RD as an absolute function of elapsed time from
  `rd_anchor` + `last_rated_at`. Never mutate RD incrementally — the
  job must stay idempotent and cadence-independent.
- Touches RD only. Never rating, never sigma.

Audit
- `RatingHistory` is append-only, written once per team per closure.
- A post-closure correction is a recomputation from `RatingHistory`,
  never a live edit of a committed rating.

---

## 5. Auth & RBAC

- JWT via HttpOnly cookies (`access_token`, `refresh_token`), set in `AuthController`.
- Guards are **global** (`app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector))` in `main.ts`) — every route requires auth by default.
- Use `@Public()` (`src/auth/decorators/public.decorator.ts`) to explicitly opt a route out of the auth requirement (e.g. `POST /auth/register`, `POST /auth/login`, all of `ScrimsController`).
- Use `@Roles(Role.ADMIN, ...)` (`src/auth/decorators/roles.decorator.ts`) to restrict a route to specific roles. No decorator = any authenticated user.
- RBAC enforces **five user tiers** per §2:
  - 4 institutional tiers (gated by verified `.edu.ph` institutional domain): `ATHLETE`, `COACH`, `NON_ATHLETE`, `ADMIN`.
  - 1 non-institutional tier (not `.edu.ph` gated): `ORGANIZER` (applies per-event with dedicated credentials via `/organizer/login` and `/organizer/register`; every proposal is individually reviewed and approved/rejected by an Admin).
- Never hand-roll auth checks in a service when a guard/decorator can express the same rule declaratively at the controller.

---

## 6. Notifications

- `NotificationsModule` (`src/notifications/`) is the single source of truth for in-app notifications — there is no client-side derivation anymore. If an event should notify a user, call `NotificationsService.create({ userId, category, type, title, message, link, refId })` from the service that owns that event (see `TeamsService.joinTeam`/`handleJoinRequest`, `ScrimsService.acceptScrim`/`confirmScrim`/`cancelScrim`).
- `category` is `SCRIM | TEAM | TOURNAMENT`; `type` is one of the `NotificationType` enum values in `schema.prisma` — add a new enum value (plus a migration) before inventing a new event type, don't overload an existing one.
- Pass `refId` whenever the same event could plausibly fire twice for the same user (e.g. a scrim id, or `team.id:member.id`) — `NotificationsService.create` uses `(userId, type, refId)` to no-op instead of creating a duplicate.
- Compose the full human-readable `title`/`message` server-side at creation time. The frontend renders them verbatim — it does not reconstruct sentences from raw fields, so don't send fragments expecting the client to assemble them.
- Delivery is push, not poll: `NotificationsService` calls `RealtimeGateway.emitToUser(userId, event, payload)` (`src/realtime/`) on every mutation (`notification:new`, `notification:updated`, `notification:all-read`, `notification:cleared`). REST (`GET /notifications`) is only for initial hydration and reconnect catch-up — don't reintroduce client-side polling for something the gateway already pushes.
- `RealtimeGateway` is generic app-wide realtime infra, not notifications-specific — it authenticates a socket with the same `access_token` cookie as REST and joins it to room `user:<id>`. Scrim chat reuses the same gateway with a second room scheme (`scrim:<id>`, joined/left via `scrim:join`/`scrim:leave`, authorized to `ACCEPTED` `TeamMember`s of either side of the scrim) and `emitToScrim(scrimId, event, payload)` — see `ScrimsService.sendScrimChat`. Note: Scrim chat is practice chat, distinct from the per-tournament War Room (created after roster lock for Organizer + verified rosters).
- **Auth race condition, already fixed once — don't reintroduce it**: a socket's `connect` event fires client-side as soon as the transport handshake completes, which is *not* guaranteed to happen after the server's async `handleConnection` (JWT verify + Prisma user lookup) finishes setting `client.data.userId`. A client that emits a message immediately on `connect` (e.g. `scrim:join`) can race ahead of that. Confirmed live: in a 3-socket test, 2 of 3 lost the race. Fix is `RealtimeGateway.authenticate(client)` — a shared helper every `@SubscribeMessage` handler calls (fast-path returns `client.data.userId` if `handleConnection` already set it, otherwise re-verifies inline) — never read `client.data.userId` directly in a new handler; call `authenticate()` instead.

---

## 7. API Design Conventions

- REST resource routing: `GET /resource`, `GET /resource/:id`, `POST /resource`, `PATCH /resource/:id/...`. Match the existing shape in `TeamsController`/`TournamentsController` for new routes on the same resource.
- Every route gets `@ApiOperation({ summary: '...' })`; every controller gets `@ApiTags('...')`. Swagger (`/api-docs`) is the standard way to exercise admin-only or hard-to-reach routes (e.g. `POST /tournaments/:id/matches/:mid/close`) — keep it accurate.
- Route ordering matters only when path segment counts collide (e.g. two single-segment `GET /:id`-shaped routes on the same controller) — check for that before adding a new dynamic-segment route.
- Response shapes returned to the frontend should be either the raw Prisma model (with deliberate `include`/`select`) or a small explicitly-mapped DTO-like object (see `UniversitiesService.findAll(gameTitle)`) — avoid inventing a third ad hoc shape per endpoint.

---

## 8. Testing

- Unit tests are colocated as `<name>.spec.ts` next to the file they test, using Jest + `@nestjs/testing`.
- Services are tested with `PrismaService` mocked (see `universities.service.spec.ts` for the pattern: a `mockPrismaService` object with `jest.fn()` per method used).
- When changing a service method's Prisma call shape (e.g. adding an `include`), update the corresponding mock's `toHaveBeenCalledWith` expectation in the same commit — a passing build does not catch a stale test expectation.
- Run `nix develop --command pnpm test` before considering a change done, not just `pnpm build`.

---

## 9. Git Commit and Branching Discipline

Full detail in `CONTRIBUTING.md` — the summary:
- Conventional Commits, **with scope**: `<type>(<scope>): <description>` (e.g. `fix(tournaments): add missing GET /tournaments list endpoint`). Common scopes: `auth`, `users`, `ranking`, `scrims`, `tournaments`, `teams`, `universities`, `notifications`, `prisma`, `redis`, `ci`.
- Branch from `dev`: `feat/<description>`, `fix/<description>`, `docs/<description>`, `refactor/<description>`, `chore/<description>`.
- Commit every fix, feature, or chore step-by-step — don't bundle unrelated changes into one commit.
- Imperative mood, no capital first letter unless a proper noun, no trailing period.

---

## 10. Verification and Quality Assurance

Before considering any task done:
- [ ] `nix develop --command pnpm test` — all suites pass.
- [ ] `nix develop --command pnpm build` — compiles clean.
- [ ] If a DTO changed: hit the real endpoint (curl/Swagger), not just the type checker — see Section 3.
- [ ] If `schema.prisma` changed: `nix develop --command npx prisma generate` ran, and a named migration exists.
- [ ] Commit Discipline — every fix/feature/chore committed step-by-step per `CONTRIBUTING.md`.

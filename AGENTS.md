# Collegium Server — Development Guidelines and Engineering Standards

This document outlines mandatory architectural patterns, coding conventions, and NestJS best practices for `collegium-server`.

All developers and automated agents must inspect the surrounding codebase conventions first and strictly adhere to these guidelines to ensure code quality, maintainability, and correctness.

---

## 1. Codebase Inspection Protocol

Before implementing features, modifying modules, or adding endpoints:
1. **Inspect existing conventions**: Look at how existing modules are structured (`src/teams/`, `src/tournaments/`, `src/auth/`) before adding a new one.
2. **Reuse established services**: Use `PrismaService` (`src/prisma/prisma.service.ts`) for all database access, `GlickoService` (`src/universities/glicko.service.ts`) for rating math. Do not duplicate query logic or reimplement algorithms that already exist.
3. **One module per domain**: `auth`, `teams`, `tournaments`, `scrims`, `universities`, `match-logging`. A new domain concept gets a new module, not a folder bolted onto an existing one.

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
- Use `include`/`select` deliberately and only for what the caller needs (e.g. `UniversitiesService.findOne()` includes `gameRatings` because the profile page needs it; don't over-fetch relations "just in case").
- Ratings are per-game (`UniversityGameRating`), not just on `University` — when adding rating-affecting logic, write to the per-game row, not the legacy global field.
- **Migrations are always named**: `nix develop --command npx prisma migrate dev --name <descriptive_name>`.
- After any `schema.prisma` change, run `nix develop --command npx prisma generate` before building — stale generated types are a common source of confusing build errors.
- `prisma migrate dev` requires an interactive TTY and will refuse to run non-interactively (e.g. from an agent or CI) whenever the change is destructive, such as removing an enum value. In that situation, hand-author the migration SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` following Prisma's own generated pattern (see `20260817092342_remove_coach_role` for the enum-value-removal pattern) and apply it non-interactively with `nix develop --command npx prisma migrate deploy`.
- The seed script (`prisma/seed.ts`) is destructive by design (wipes all tables before reseeding) and is the one place a raw `PrismaClient` + `PrismaPg` adapter is constructed by hand, mirroring `PrismaService`'s constructor.

---

## 5. Auth & RBAC

- JWT via HttpOnly cookies (`access_token`, `refresh_token`), set in `AuthController`.
- Guards are **global** (`app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector))` in `main.ts`) — every route requires auth by default.
- Use `@Public()` (`src/auth/decorators/public.decorator.ts`) to explicitly opt a route out of the auth requirement (e.g. `POST /auth/register`, `POST /auth/login`, all of `ScrimsController`).
- Use `@Roles(Role.ADMIN, ...)` (`src/auth/decorators/roles.decorator.ts`) to restrict a route to specific roles. No decorator = any authenticated user.
- `Role` is `ATHLETE | NON_ATHLETE | ADMIN` — there is no `COACH` role (removed; team captains, who are `ATHLETE`, now perform what used to be coach-gated actions).
- Never hand-roll auth checks in a service when a guard/decorator can express the same rule declaratively at the controller.

---

## 6. API Design Conventions

- REST resource routing: `GET /resource`, `GET /resource/:id`, `POST /resource`, `PATCH /resource/:id/...`. Match the existing shape in `TeamsController`/`TournamentsController` for new routes on the same resource.
- Every route gets `@ApiOperation({ summary: '...' })`; every controller gets `@ApiTags('...')`. Swagger (`/api-docs`) is the standard way to exercise admin-only or hard-to-reach routes (e.g. `POST /tournaments/:id/matches/:mid/close`) — keep it accurate.
- Route ordering matters only when path segment counts collide (e.g. two single-segment `GET /:id`-shaped routes on the same controller) — check for that before adding a new dynamic-segment route.
- Response shapes returned to the frontend should be either the raw Prisma model (with deliberate `include`/`select`) or a small explicitly-mapped DTO-like object (see `UniversitiesService.findAll(gameTitle)`) — avoid inventing a third ad hoc shape per endpoint.

---

## 7. Testing

- Unit tests are colocated as `<name>.spec.ts` next to the file they test, using Jest + `@nestjs/testing`.
- Services are tested with `PrismaService` mocked (see `universities.service.spec.ts` for the pattern: a `mockPrismaService` object with `jest.fn()` per method used).
- When changing a service method's Prisma call shape (e.g. adding an `include`), update the corresponding mock's `toHaveBeenCalledWith` expectation in the same commit — a passing build does not catch a stale test expectation.
- Run `nix develop --command pnpm test` before considering a change done, not just `pnpm build`.

---

## 8. Git Commit and Branching Discipline

Full detail in `CONTRIBUTING.md` — the summary:
- Conventional Commits, **with scope**: `<type>(<scope>): <description>` (e.g. `fix(tournaments): add missing GET /tournaments list endpoint`). Common scopes: `auth`, `users`, `ranking`, `scrims`, `tournaments`, `teams`, `universities`, `prisma`, `redis`, `ci`.
- Branch from `dev`: `feat/<description>`, `fix/<description>`, `docs/<description>`, `refactor/<description>`, `chore/<description>`.
- Commit every fix, feature, or chore step-by-step — don't bundle unrelated changes into one commit.
- Imperative mood, no capital first letter unless a proper noun, no trailing period.

---

## 9. Verification and Quality Assurance

Before considering any task done:
- [ ] `nix develop --command pnpm test` — all suites pass.
- [ ] `nix develop --command pnpm build` — compiles clean.
- [ ] If a DTO changed: hit the real endpoint (curl/Swagger), not just the type checker — see Section 3.
- [ ] If `schema.prisma` changed: `nix develop --command npx prisma generate` ran, and a named migration exists.
- [ ] Commit Discipline — every fix/feature/chore committed step-by-step per `CONTRIBUTING.md`.

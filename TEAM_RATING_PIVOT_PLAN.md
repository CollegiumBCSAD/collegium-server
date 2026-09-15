# Team-Level Rating Entity Pivot: Discovery Report & Implementation Plan (Revised)

This document is the revised implementation plan for executing the team-level rating entity pivot in `collegium-server`.

---

## 1. Scope & Objective

Pivots the rating entity in `collegium-server`'s Prisma schema from `University` to `Team`, scoped per `GameTitle`, in accordance with `claude_collegium-server-reference-v2.md` (§5.1, §5.2, §8, §10).

### Key Directives:
1. **Schema Changes**:
   - Add rating fields & roster sizes to `Team`: `min_roster_size` and `max_roster_size` have **no default values** and must be set explicitly per `gameTitle` (Valorant 5/6, MLBB 5/6, CODM 5/6, LoL 5/7).
   - Add `RatingHistory` model.
   - Add `event_weight`, `locked_at`, and `rating_period_closed_at` to `Tournament`.
   - Remove `UniversityGameRating` model and `University.glicko2_*` fields.
2. **Zero Rating Writes**:
   - Remove all rating calculations and mutations from `TournamentsService.closeMatch()`. The new rating path will be a tournament-closure batch computation built in a later task.
3. **Legacy Glicko Service**:
   - Retain `src/universities/glicko.service.ts` (and its spec) untouched in functionality, adding only a top-level header comment marking it as superseded per-match logic not to be called by any service.
4. **Documentation Alignment**:
   - Correct all identified contradictions across `AGENTS.md` (RBAC 5 tiers, two-tier Organizer verification, Glicko service deprecation note, and verbatim rating binding rules).
   - Replace `collegium-server/reference.md` with a clean, concise pointer to `claude_collegium-server-reference-v2.md` (no duplicated content).
5. **Database Data**:
   - All DB data is local mock seed data — no data migration needed.

---

## 2. Discovery Report

### 2.1 Reads & Writes of `University.glicko2_*` and `UniversityGameRating`

| Location | Read / Write | Entity & Fields | Details |
|---|---|---|---|
| `src/universities/universities.service.ts:18` | **Read** | `University.glicko2_rating` | `orderBy: { glicko2_rating: 'desc' }` in `findAll()` when `!gameTitle` |
| `src/universities/universities.service.ts:19` | **Read** | `University.gameRatings` | `include: { gameRatings: true }` in `findAll()` when `!gameTitle` |
| `src/universities/universities.service.ts:25-46` | **Read** | `UniversityGameRating.*` | Reads `glicko2_rating`, `glicko2_rd`, `glicko2_sigma`, `wins`, `losses` for filtered query |
| `src/universities/universities.service.ts:52` | **Read** | `University.gameRatings` | `include: { gameRatings: true }` in `findOne(id)` |
| `src/universities/universities.service.spec.ts:36-50` | **Assert** | `University.glicko2_rating`, `gameRatings` | Tests `findAll()` sorting by `glicko2_rating: 'desc'` |
| `src/universities/universities.service.spec.ts:53-65` | **Assert** | `University.gameRatings` | Tests `findOne()` including `gameRatings: true` |
| `src/tournaments/tournaments.service.ts:1064-1084` | **Read/Write** | `UniversityGameRating` | `upsert` of winner/loser per-game rating records |
| `src/tournaments/tournaments.service.ts:1086-1096` | **Read** | `UniversityGameRating.*` | Passes rating values to `glickoService.calculateMatch()` |
| `src/tournaments/tournaments.service.ts:1099-1117` | **Write** | `UniversityGameRating` | `update` of winner/loser rating, RD, sigma, wins, and losses |
| `src/tournaments/tournaments.service.spec.ts:39-42, 84-92` | **Mock** | `UniversityGameRating` | Mocks `upsert` and `update` in test setup |
| `prisma/seed.ts:63, 225-236` | **Write** | `UniversityGameRating` | Deletes and creates 8 rating rows for VALORANT |
| `prisma/schema.prisma:90-92, 99` | **Schema** | `University.glicko2_*`, `gameRatings` | Field declarations on `University` |
| `prisma/schema.prisma:104-117` | **Schema** | `UniversityGameRating` model | Model definition |

---

### 2.2 Current Body of `TournamentsService.closeMatch()`

From `src/tournaments/tournaments.service.ts`:

```typescript
  // CLOSE MATCH — Admin/Organizer manually reports the winner and per-player
  // stats for a match (no Riot API involved), verifying it and running ratings.
  async closeMatch(tournamentId: string, matchId: string, dto: CloseMatchDto) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, tournamentId },
    });

    if (!match) {
      throw new NotFoundException('Match not found in this tournament');
    }

    if (match.isVerified) {
      throw new BadRequestException('This match is already closed');
    }

    const contestants = [match.winnerId, match.loserId].filter(
      (id): id is string => !!id,
    );

    if (!contestants.includes(dto.winnerId)) {
      throw new BadRequestException(
        'winnerId must be one of the two universities in this match',
      );
    }

    const loserId = contestants.find((id) => id !== dto.winnerId)!;

    for (const player of dto.players) {
      if (!contestants.includes(player.universityId)) {
        throw new BadRequestException(
          `Player university ${player.universityId} is not one of the two universities in this match`,
        );
      }
    }

    // ====== LINES 1064-1117: TO BE REMOVED COMPLETELY ======
    const winnerRating = await this.prisma.universityGameRating.upsert({ ... });
    const loserRating = await this.prisma.universityGameRating.upsert({ ... });
    const result = this.glickoService.calculateMatch( ... );
    await this.prisma.universityGameRating.update({ where: { id: winnerRating.id }, data: { ... } });
    await this.prisma.universityGameRating.update({ where: { id: loserRating.id }, data: { ... } });
    // ====== END OF REMOVED CODE ======

    await this.prisma.playerStat.createMany({
      data: dto.players.map((player) => ({
        matchId,
        universityId: player.universityId,
        userId: player.userId,
        summonerName: player.name,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        win: player.universityId === dto.winnerId,
        dataSource: DataSource.PEER_VERIFIED,
      })),
    });

    const closed = await this.prisma.match.update({
      where: { id: matchId },
      data: { winnerId: dto.winnerId, loserId, isVerified: true },
    });

    await this.tryAdvanceBracket(tournamentId);

    return closed;
  }
```

---

### 2.3 Current Body of `UniversitiesService.findAll()`

From `src/universities/universities.service.ts`:

```typescript
  async findAll(gameTitle?: GameTitle) {
    if (!gameTitle) {
      return this.prisma.university.findMany({
        orderBy: { glicko2_rating: 'desc' },
        include: { gameRatings: true },
      });
    }
    // ... maps and sorts by ratingRecord.glicko2_rating
  }
```

**Behavior today with no `gameTitle`:**  
Queries `prisma.university.findMany` with `orderBy: { glicko2_rating: 'desc' }` and `include: { gameRatings: true }`.

---

### 2.4 Schema Check Confirmations
- **`RatingHistory`**: Does NOT exist in schema.
- **`TournamentRoster`**: Does NOT exist in schema.
- **`Event Weight` fields**: Do NOT exist anywhere in schema.

---

### 2.5 Confirmed Test Environment Status
- `lib/glicko2.util.ts`, `glicko2.util.spec.ts`, and `order-independence.spec.ts` **do not exist** in this branch.
- Only `src/universities/glicko.service.ts` and `src/universities/glicko.service.spec.ts` exist.

---

## 3. Comprehensive AGENTS.md & reference.md Corrections

### 3.1 All Five AGENTS.md Contradictions Fixed in this PR:
1. **Section 1 (Line 13) — `GlickoService` Reference:**  
   Update reference note: `src/universities/glicko.service.ts` is the superseded per-match helper (retained temporarily, not to be called from any service). Future rating calculations belong under `ranking/`.
2. **Section 1 & 4 (Line 14) — Two-Tier Organizer Verification:**  
   Clarify that match verification is Two-Tier Organizer verification (manual scoreboard transcription + EasyOCR fallback). The Riot Games API is prospective/supplementary only.
3. **Section 4 (Line 57) — Relation Selection:**  
   Remove `gameRatings` from the example query recommendation since the model is dropped.
4. **Section 4 (Line 58) — Verbatim Binding Rating Rules:**  
   Replace line 58 with the user-provided `## Rating Engine — Binding Rules` block verbatim.
5. **Section 5 (Line 72) — RBAC Tiers:**  
   Correct the RBAC section to list **all five tiers**:
   - 4 institutional tiers (gated by `.edu.ph`): `ATHLETE`, `COACH`, `NON_ATHLETE`, `ADMIN`.
   - 1 non-institutional tier (not `.edu.ph` gated): `ORGANIZER`.
6. **Section 6 (Lines 80, 84) — Notification & War Room Conflations:**  
   Include `TOURNAMENT` in categories; clarify that War Room is strictly per-tournament for Organizer + verified rosters (not unranked scrim chat).

### 3.2 `collegium-server/reference.md` Pointer Replacement:
Delete the stale 499-line `reference.md` and replace it with:
```markdown
# Collegium – Backend Server Reference Pointer

> **Notice:** This file has been superseded and replaced.
> 
> The single authoritative ground-truth reference for the backend server is:
> [`claude_collegium-server-reference-v2.md`](./claude_collegium-server-reference-v2.md)
>
> Refer strictly to `claude_collegium-server-reference-v2.md` for all architectural specifications, data models, rating rules, and module design.
```

---

## 4. Key Design Decisions

### Decision 1: `UniversitiesService.findAll(gameTitle?: GameTitle)`
* **Option A (Institutional Directory):**
  - If **no `gameTitle`**: Return universities ordered alphabetically:  
    `prisma.university.findMany({ orderBy: { name: 'asc' } })`.
  - If **`gameTitle` provided**: Query `Team` records for that game title ordered by `glicko2_rating: 'desc'`, joined with university details.
* *(Option A preserves clean public directory lookups without synthesizing forbidden institutional rating aggregates).*

### Decision 2: Tournament Fields Naming
Matching §8 of the authoritative spec:
- `event_weight: Float?`
- `locked_at: DateTime?` (bracket lock freeze indicator)
- `rating_period_closed_at: DateTime?` (closure idempotency guard)

---

## 5. Detailed Implementation Steps

### Step 1: `prisma/schema.prisma` & Database Migration
1. **Modify `model Team`**:
   ```prisma
   model Team {
     id              String       @id @default(uuid())
     name            String
     gameTitle       GameTitle
     universityId    String
     university      University   @relation(fields: [universityId], references: [id])
     captainId       String
     captain         User         @relation("TeamCaptain", fields: [captainId], references: [id])
     inviteCode      String       @unique
     glicko2_rating  Float        @default(1500)
     glicko2_rd      Float        @default(350)
     glicko2_sigma   Float        @default(0.06)
     rd_anchor       Float        @default(350)
     last_rated_at   DateTime?
     min_roster_size Int
     max_roster_size Int
     createdAt       DateTime     @default(now())
     members         TeamMember[]
     hostedScrims    Scrim[]      @relation("ScrimHost")
     acceptedScrims  Scrim[]      @relation("ScrimOpponent")
     tournamentApplications TournamentApplication[]
     ratingHistory   RatingHistory[]
   }
   ```
   *(Note: `min_roster_size` and `max_roster_size` have **no `@default`** attribute).*

2. **Add `model RatingHistory`**:
   ```prisma
   model RatingHistory {
     id            String      @id @default(uuid())
     team_id       String
     team          Team        @relation(fields: [team_id], references: [id], onDelete: Cascade)
     tournament_id String
     tournament    Tournament  @relation(fields: [tournament_id], references: [id], onDelete: Cascade)
     rating_before Float
     rd_before     Float
     sigma_before  Float
     rating_after  Float
     rd_after      Float
     sigma_after   Float
     raw_delta     Float
     event_weight  Float
     closed_at     DateTime    @default(now())

     @@index([team_id])
     @@index([tournament_id])
   }
   ```

3. **Modify `model Tournament`**:
   ```prisma
   model Tournament {
     // ... existing fields ...
     event_weight            Float?
     locked_at               DateTime?
     rating_period_closed_at DateTime?
     ratingHistories         RatingHistory[]
   }
   ```

4. **Modify `model University`**:
   Remove `glicko2_rating`, `glicko2_rd`, `glicko2_sigma`, and `gameRatings UniversityGameRating[]`.

5. **Drop `model UniversityGameRating`**.

6. Run migration:
   `npx prisma migrate dev --name team_level_rating_pivot`.

---

### Step 2: Remove Rating Writes from `TournamentsService.closeMatch()`
- In `src/tournaments/tournaments.service.ts`, remove lines 1064–1117 (upsert of `universityGameRating`, call to `glickoService.calculateMatch`, and update of `universityGameRating`).
- Remove `GlickoService` dependency injection from `TournamentsService`.
- Retain player stats insertion, match result update (`winnerId`, `loserId`, `isVerified: true`), and `tryAdvanceBracket`.

---

### Step 3: Add Superseded Header to `src/universities/glicko.service.ts`
Add the following header to `src/universities/glicko.service.ts`:
```typescript
/**
 * SUPERSEDED: This is the legacy per-match Glicko-2 calculation service.
 * It is retained temporarily for reference and legacy test compatibility.
 * DO NOT call this service from any active application workflow.
 * The production rating pipeline uses batch closure calculation under ranking/.
 */
```
Leave all underlying logic and `glicko.service.spec.ts` untouched.

---

### Step 4: Update `UniversitiesService` & Spec Files
- In `src/universities/universities.service.ts`:
  - Update `findAll()` to sort alphabetically by name when no `gameTitle` is provided, and return teams for that title when `gameTitle` is provided.
  - In `findOne()`, remove `include: { gameRatings: true }`.
- In `src/universities/universities.service.spec.ts`:
  - Update tests to verify alphabetical name sorting and remove `gameRatings` assertions.
- In `src/tournaments/tournaments.service.spec.ts`:
  - Remove `universityGameRating` mocks and `GlickoService` provider from `beforeEach`.

---

### Step 5: Update `prisma/seed.ts`
- Remove `universityGameRating` wipe and seed creation.
- Remove simulated `COMPLETED_BRACKET` Glicko execution loop.
- In the `Team` creation loop:
  - Populate cold-start defaults: `glicko2_rating: 1500`, `glicko2_rd: 350`, `glicko2_sigma: 0.06`, `rd_anchor: 350`, `last_rated_at: null`.
  - Set title-specific roster limits explicitly (§10):
    - `VALORANT`: `min_roster_size: 5`, `max_roster_size: 6`
    - `MLBB`: `min_roster_size: 5`, `max_roster_size: 6`
    - `CODM`: `min_roster_size: 5`, `max_roster_size: 6`
    - `LOL`: `min_roster_size: 5`, `max_roster_size: 7`

---

### Step 6: Update Documentation
- **`collegium-server/AGENTS.md`**:
  - Insert the verbatim `## Rating Engine — Binding Rules` block.
  - Update RBAC section to 5 tiers (`ATHLETE`, `COACH`, `NON_ATHLETE`, `ADMIN`, `ORGANIZER`).
  - Update `GlickoService` and match verification guidance.
- **`collegium-server/reference.md`**:
  - Replace with the concise pointer file pointing to `claude_collegium-server-reference-v2.md`.
- **`collegium-server/claude_collegium-server-reference-v2.md`**:
  - Update §7 Build Status table row for Rating engine to state that the rating engine is **NOT yet implemented**, and that `src/universities/glicko.service.ts` is a superseded per-match implementation pending replacement.

---

## 6. Corrected Acceptance Criteria

1. **Migration Cleanliness**: Migration applies cleanly against the running `collegium-db` Docker container.
2. **Build & Lint**: `pnpm run build` and `pnpm run lint` pass cleanly.
3. **Unit Tests**: `pnpm test` passes, and `src/universities/glicko.service.ts` and `glicko.service.spec.ts` are unmodified in functionality by this task (carrying only the added superseded header comment).
4. **Reseed & Team Rating States**:
   `npx prisma db seed` runs cleanly. A live SQL query confirms:
   ```sql
   SELECT count(*) as total_teams, 
          count(*) FILTER (WHERE glicko2_rating = 1500 AND glicko2_rd = 350 AND glicko2_sigma = 0.06) as cold_start_teams 
   FROM "Team";
   ```
   Yields `total_teams: 32`, `cold_start_teams: 32` (32 team rating states where there were previously 8 university game ratings).
5. **Zero Rating Writes & Clean Schema**:
   A codebase grep for `glicko2_rating` / `glicko2_rd` / `glicko2_sigma` returns hits ONLY on `model Team`, `model RatingHistory`, and `src/universities/glicko.service.ts` (+ its spec). Zero hits on `University`, zero rating writes in any service.
6. **Server Health**: The NestJS dev server boots and connects without errors.

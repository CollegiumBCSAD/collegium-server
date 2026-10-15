-- Tournaments created before applications were persisted connected universities
-- directly. Ratings, seeding and leaderboard stats now resolve a school's team
-- only through an APPROVED application, so backfill one for each legacy entry.
-- Skipped: entries that already have any application, schools with more than
-- one team in the tournament's game (ambiguous), and teams with nobody to list
-- as the applicant.
INSERT INTO "TournamentApplication" (
    "id", "tournamentId", "universityId", "userId", "applicantName",
    "status", "teamId", "teamName", "appliedAt"
)
SELECT
    gen_random_uuid()::text,
    t."id",
    u."id",
    applicant."id",
    applicant."displayName",
    'APPROVED',
    team."id",
    team."name",
    t."createdAt"
FROM "_TournamentToUniversity" tu
JOIN "Tournament" t ON t."id" = tu."A"
JOIN "University" u ON u."id" = tu."B"
JOIN "Team" team
    ON team."universityId" = u."id"
   AND team."gameTitle" = COALESCE(t."gameTitle", 'VALORANT')
JOIN LATERAL (
    SELECT usr."id", usr."displayName"
    FROM "User" usr
    WHERE usr."id" = COALESCE(
        team."captainId",
        team."coachId",
        (SELECT tm."userId" FROM "TeamMember" tm
          WHERE tm."teamId" = team."id" AND tm."status" = 'ACCEPTED'
          ORDER BY tm."joinedAt" ASC LIMIT 1)
    )
) applicant ON TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM "TournamentApplication" ta
    WHERE ta."tournamentId" = t."id" AND ta."universityId" = u."id"
)
AND (
    SELECT COUNT(*) FROM "Team" other
    WHERE other."universityId" = u."id"
      AND other."gameTitle" = COALESCE(t."gameTitle", 'VALORANT')
) = 1;

-- AlterTable Team
ALTER TABLE "Team" ADD COLUMN "glicko2_rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
ADD COLUMN "glicko2_rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
ADD COLUMN "glicko2_sigma" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
ADD COLUMN "rd_anchor" DOUBLE PRECISION NOT NULL DEFAULT 350,
ADD COLUMN "last_rated_at" TIMESTAMP(3),
ADD COLUMN "min_roster_size" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "max_roster_size" INTEGER NOT NULL DEFAULT 6;

-- Set correct max roster size for LOL per §10
UPDATE "Team" SET "max_roster_size" = 7 WHERE "gameTitle" = 'LOL';

-- Drop defaults on roster sizes so schema matches (no default)
ALTER TABLE "Team" ALTER COLUMN "min_roster_size" DROP DEFAULT;
ALTER TABLE "Team" ALTER COLUMN "max_roster_size" DROP DEFAULT;

-- AlterTable Tournament
ALTER TABLE "Tournament" ADD COLUMN "event_weight" DOUBLE PRECISION,
ADD COLUMN "locked_at" TIMESTAMP(3),
ADD COLUMN "rating_period_closed_at" TIMESTAMP(3);

-- AlterTable University
ALTER TABLE "University" DROP COLUMN "glicko2_rating",
DROP COLUMN "glicko2_rd",
DROP COLUMN "glicko2_sigma";

-- DropForeignKey
ALTER TABLE "UniversityGameRating" DROP CONSTRAINT "UniversityGameRating_universityId_fkey";

-- DropTable
DROP TABLE "UniversityGameRating";

-- CreateTable
CREATE TABLE "RatingHistory" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "rating_before" DOUBLE PRECISION NOT NULL,
    "rd_before" DOUBLE PRECISION NOT NULL,
    "sigma_before" DOUBLE PRECISION NOT NULL,
    "rating_after" DOUBLE PRECISION NOT NULL,
    "rd_after" DOUBLE PRECISION NOT NULL,
    "sigma_after" DOUBLE PRECISION NOT NULL,
    "raw_delta" DOUBLE PRECISION NOT NULL,
    "event_weight" DOUBLE PRECISION NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RatingHistory_team_id_idx" ON "RatingHistory"("team_id");

-- CreateIndex
CREATE INDEX "RatingHistory_tournament_id_idx" ON "RatingHistory"("tournament_id");

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

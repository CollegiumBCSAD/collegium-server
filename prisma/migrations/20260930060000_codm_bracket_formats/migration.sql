-- CreateEnum
CREATE TYPE "BracketFormat" AS ENUM ('SINGLE_ELIM', 'DOUBLE_ELIM', 'ROUND_ROBIN', 'TWO_STAGE');

-- AlterTable: convert the free-text bracketFormat into the enum, preserving the
-- values the engine previously matched by string literal. Anything unrecognised
-- (including NULL) becomes SINGLE_ELIM, which is what the old code fell through to.
ALTER TABLE "Tournament" ADD COLUMN "bracketFormatEnum" "BracketFormat";

UPDATE "Tournament" SET "bracketFormatEnum" = CASE
  WHEN "bracketFormat" = 'Double Elimination' THEN 'DOUBLE_ELIM'::"BracketFormat"
  WHEN "bracketFormat" = 'Round Robin + Playoffs' THEN 'TWO_STAGE'::"BracketFormat"
  ELSE 'SINGLE_ELIM'::"BracketFormat"
END;

ALTER TABLE "Tournament" DROP COLUMN "bracketFormat";
ALTER TABLE "Tournament" RENAME COLUMN "bracketFormatEnum" TO "bracketFormat";

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "playoffTeamCount" INTEGER;
ALTER TABLE "Tournament" ADD COLUMN "championUniversityId" TEXT;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_championUniversityId_fkey" FOREIGN KEY ("championUniversityId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

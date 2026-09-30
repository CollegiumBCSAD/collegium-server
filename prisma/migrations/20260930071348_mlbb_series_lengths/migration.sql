-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "bestOfEarly" INTEGER,
ADD COLUMN     "bestOfFinal" INTEGER,
ADD COLUMN     "bestOfLate" INTEGER,
ADD COLUMN     "playoffBracket" "BracketFormat";

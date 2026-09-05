-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'GRAND_FINAL');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracketSide" "BracketSide",
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

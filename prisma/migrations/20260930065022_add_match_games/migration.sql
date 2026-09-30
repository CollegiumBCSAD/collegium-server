-- CreateEnum
CREATE TYPE "MatchGameMode" AS ENUM ('HARDPOINT', 'SEARCH_AND_DESTROY', 'CONTROL');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bestOf" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PlayerStat" ADD COLUMN     "matchGameId" TEXT;

-- CreateTable
CREATE TABLE "MatchGame" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "mode" "MatchGameMode",
    "winnerId" TEXT,
    "loserId" TEXT,
    "winnerScore" INTEGER,
    "loserScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchGame_matchId_gameNumber_key" ON "MatchGame"("matchId", "gameNumber");

-- AddForeignKey
ALTER TABLE "MatchGame" ADD CONSTRAINT "MatchGame_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchGame" ADD CONSTRAINT "MatchGame_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchGame" ADD CONSTRAINT "MatchGame_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_matchGameId_fkey" FOREIGN KEY ("matchGameId") REFERENCES "MatchGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fills the schema changes that reached the dev database through
-- `prisma db push`: team-level tournament applications with an immutable
-- roster snapshot, the global tournament chat channel, forfeit bookkeeping on
-- Match, and the Scrim -> Match link that the scrim OCR ledger writes.
--
-- NOTE: the `teamId SET NOT NULL` below fails on any database still holding
-- pre-team-level applications (teamId IS NULL). Those rows predate squad
-- registration and cannot be represented team-side; decide what to do with
-- them deliberately rather than letting a migration delete them silently.


-- DropForeignKey
ALTER TABLE "TournamentApplication" DROP CONSTRAINT "TournamentApplication_teamId_fkey";

-- DropIndex
DROP INDEX "TournamentApplication_tournamentId_userId_key";

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "forfeitingTeamId" TEXT,
ADD COLUMN     "isForfeit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scrimId" TEXT;

-- AlterTable
ALTER TABLE "TournamentApplication" ADD COLUMN     "rosterSnapshot" JSONB,
ALTER COLUMN "teamId" SET NOT NULL;

-- CreateTable
CREATE TABLE "TournamentChatMessage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "teamName" TEXT,
    "text" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentChatMessage_tournamentId_createdAt_idx" ON "TournamentChatMessage"("tournamentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_scrimId_key" ON "Match"("scrimId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentApplication_tournamentId_teamId_key" ON "TournamentApplication"("tournamentId", "teamId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_scrimId_fkey" FOREIGN KEY ("scrimId") REFERENCES "Scrim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentApplication" ADD CONSTRAINT "TournamentApplication_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentChatMessage" ADD CONSTRAINT "TournamentChatMessage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentChatMessage" ADD CONSTRAINT "TournamentChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


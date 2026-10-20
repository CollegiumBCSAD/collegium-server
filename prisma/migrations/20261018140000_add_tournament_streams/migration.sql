-- CreateTable
CREATE TABLE "TournamentStream" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "matchId" TEXT,
    "isLive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentStream_tournamentId_idx" ON "TournamentStream"("tournamentId");

-- AddForeignKey
ALTER TABLE "TournamentStream" ADD CONSTRAINT "TournamentStream_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry each tournament's existing single stream over as its first entry.
INSERT INTO "TournamentStream" ("id", "tournamentId", "url", "matchId", "isLive")
SELECT gen_random_uuid()::text, "id", "streamUrl", "featuredMatchId", "streamIsLive"
FROM "Tournament"
WHERE "streamUrl" IS NOT NULL AND btrim("streamUrl") <> '';

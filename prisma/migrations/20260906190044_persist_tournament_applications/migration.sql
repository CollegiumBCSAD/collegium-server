-- CreateEnum
CREATE TYPE "TournamentApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TournamentApplication" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "status" "TournamentApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "teamId" TEXT,
    "teamName" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentApplication_tournamentId_idx" ON "TournamentApplication"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentApplication_tournamentId_userId_key" ON "TournamentApplication"("tournamentId", "userId");

-- AddForeignKey
ALTER TABLE "TournamentApplication" ADD CONSTRAINT "TournamentApplication_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentApplication" ADD CONSTRAINT "TournamentApplication_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentApplication" ADD CONSTRAINT "TournamentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentApplication" ADD CONSTRAINT "TournamentApplication_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

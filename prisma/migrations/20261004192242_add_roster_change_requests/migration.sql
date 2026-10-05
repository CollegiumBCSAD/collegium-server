-- CreateEnum
CREATE TYPE "RosterChangeReason" AS ENUM ('INJURY', 'ILLNESS', 'ACADEMIC', 'PERSONAL_EMERGENCY', 'ELIGIBILITY', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RosterChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ROSTER_MEMBER_REMOVED';
ALTER TYPE "NotificationType" ADD VALUE 'ROSTER_CHANGE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ROSTER_CHANGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'ROSTER_CHANGE_REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_MEMBER_UPDATED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_MEMBER_REMOVED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'CAPTAIN_TRANSFERRED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_CHANGE_REQUESTED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_CHANGE_APPROVED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_CHANGE_REJECTED';
ALTER TYPE "TeamAuditAction" ADD VALUE 'ROSTER_CHANGE_CANCELLED';

-- CreateTable
CREATE TABLE "RosterChangeRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "outUserId" TEXT NOT NULL,
    "inUserId" TEXT NOT NULL,
    "reason" "RosterChangeReason" NOT NULL,
    "details" TEXT NOT NULL,
    "status" "RosterChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterChangeRequest_tournamentId_status_idx" ON "RosterChangeRequest"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "RosterChangeRequest_teamId_createdAt_idx" ON "RosterChangeRequest"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TournamentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_outUserId_fkey" FOREIGN KEY ("outUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_inUserId_fkey" FOREIGN KEY ("inUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChangeRequest" ADD CONSTRAINT "RosterChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

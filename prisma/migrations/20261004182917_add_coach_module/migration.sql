-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PracticeResult" AS ENUM ('WIN', 'LOSS');

-- CreateEnum
CREATE TYPE "PracticeRecordSource" AS ENUM ('OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "TeamAuditAction" AS ENUM ('TEAM_CREATED', 'COACH_INVITE_SENT', 'COACH_INVITE_ACCEPTED', 'COACH_REMOVED', 'TOURNAMENT_REGISTERED', 'TOURNAMENT_WITHDRAWN', 'PRACTICE_SCHEDULED', 'PRACTICE_UPDATED', 'PRACTICE_CANCELLED', 'PRACTICE_RECORD_LOGGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'COACH_ACCOUNT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'COACH_ACCOUNT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'COACH_INVITE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'COACH_INVITE_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'COACH_INVITE_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'PRACTICE_SCHEDULED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'COACH';

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_captainId_fkey";

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "coachId" TEXT,
ALTER COLUMN "captainId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "maxTeamsPerUniversity" INTEGER;

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSchedule" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeRecord" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "opponentName" TEXT,
    "result" "PracticeResult" NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "source" "PracticeRecordSource" NOT NULL,
    "ocrConfidence" DOUBLE PRECISION,
    "notes" TEXT,
    "loggedById" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamAuditLog" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" "TeamAuditAction" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamInvitation_coachId_status_idx" ON "TeamInvitation"("coachId", "status");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_status_idx" ON "TeamInvitation"("teamId", "status");

-- CreateIndex
CREATE INDEX "PracticeSchedule_teamId_startsAt_idx" ON "PracticeSchedule"("teamId", "startsAt");

-- CreateIndex
CREATE INDEX "PracticeRecord_teamId_playedAt_idx" ON "PracticeRecord"("teamId", "playedAt");

-- CreateIndex
CREATE INDEX "TeamAuditLog_teamId_createdAt_idx" ON "TeamAuditLog"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamAuditLog_actorId_createdAt_idx" ON "TeamAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Team_coachId_idx" ON "Team"("coachId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSchedule" ADD CONSTRAINT "PracticeSchedule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSchedule" ADD CONSTRAINT "PracticeSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PracticeSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAuditLog" ADD CONSTRAINT "TeamAuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAuditLog" ADD CONSTRAINT "TeamAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

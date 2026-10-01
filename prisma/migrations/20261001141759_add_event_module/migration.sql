-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'ONGOING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EventTeamStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameTitle" "GameTitle" NOT NULL,
    "bracketFormat" "BracketFormat" NOT NULL DEFAULT 'SINGLE_ELIM',
    "inviteCode" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "organizerId" TEXT NOT NULL,
    "signupsCloseAt" TIMESTAMP(3),
    "rules" TEXT,
    "maxSubs" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTeam" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "logoPublicId" TEXT,
    "captainName" TEXT NOT NULL,
    "captainEmail" TEXT NOT NULL,
    "editToken" TEXT NOT NULL,
    "roster" JSONB NOT NULL,
    "status" "EventTeamStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "seed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "bestOf" INTEGER NOT NULL DEFAULT 3,
    "teamAId" TEXT,
    "teamBId" TEXT,
    "winnerId" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "playedAt" TIMESTAMP(3),

    CONSTRAINT "EventMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_inviteCode_key" ON "Event"("inviteCode");

-- CreateIndex
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTeam_editToken_key" ON "EventTeam"("editToken");

-- CreateIndex
CREATE INDEX "EventTeam_eventId_status_idx" ON "EventTeam"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventTeam_eventId_name_key" ON "EventTeam"("eventId", "name");

-- CreateIndex
CREATE INDEX "EventMatch_eventId_idx" ON "EventMatch"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMatch_eventId_round_slot_key" ON "EventMatch"("eventId", "round", "slot");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTeam" ADD CONSTRAINT "EventTeam_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMatch" ADD CONSTRAINT "EventMatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

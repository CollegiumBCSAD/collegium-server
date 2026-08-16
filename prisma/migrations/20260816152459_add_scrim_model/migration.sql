-- CreateEnum
CREATE TYPE "TeamMemberStatus" AS ENUM ('ACCEPTED', 'PENDING', 'DECLINED');

-- CreateEnum
CREATE TYPE "ScrimStatus" AS ENUM ('OPEN', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameTitle" "GameTitle" NOT NULL,
    "universityId" TEXT NOT NULL,
    "captainId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameHandle" TEXT NOT NULL,
    "preferredRole" TEXT,
    "status" "TeamMemberStatus" NOT NULL DEFAULT 'ACCEPTED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scrim" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "gameTitle" "GameTitle" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL,
    "rankRange" TEXT,
    "mapPreference" TEXT,
    "notes" TEXT,
    "status" "ScrimStatus" NOT NULL DEFAULT 'OPEN',
    "opponentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scrim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_inviteCode_key" ON "Team"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrim" ADD CONSTRAINT "Scrim_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrim" ADD CONSTRAINT "Scrim_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

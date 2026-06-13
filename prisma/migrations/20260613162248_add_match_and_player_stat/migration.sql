/*
  Warnings:

  - You are about to drop the `university` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "GameTitle" AS ENUM ('LOL', 'VALORANT', 'MLBB', 'CODM');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('TOURNAMENT', 'SCRIM');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('API', 'PEER_VERIFIED');

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_university_id_fkey";

-- DropTable
DROP TABLE "university";

-- DropTable
DROP TABLE "users";

-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ATHLETE',
    "displayName" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "riotMatchId" TEXT,
    "title" "GameTitle" NOT NULL,
    "matchMode" "MatchMode" NOT NULL,
    "gameDuration" INTEGER NOT NULL,
    "gameMode" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerStat" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT,
    "puuid" TEXT NOT NULL,
    "summonerName" TEXT NOT NULL,
    "championName" TEXT,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "role" TEXT,
    "lane" TEXT,
    "totalDamageDealt" INTEGER,
    "totalDamageDealtToChampions" INTEGER,
    "visionScore" INTEGER,
    "objectivesStolen" INTEGER,
    "turretKills" INTEGER,
    "inhibitorKills" INTEGER,
    "win" BOOLEAN NOT NULL,
    "teamId" INTEGER,
    "vcsScore" DOUBLE PRECISION,
    "dataSource" "DataSource" NOT NULL DEFAULT 'API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "University_domain_key" ON "University"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Match_riotMatchId_key" ON "Match"("riotMatchId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

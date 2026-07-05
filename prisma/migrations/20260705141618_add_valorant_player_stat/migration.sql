-- CreateTable
CREATE TABLE "ValorantPlayerStat" (
    "id" TEXT NOT NULL,
    "playerStatId" TEXT NOT NULL,
    "agentName" TEXT,
    "combatScore" INTEGER,
    "headshotPct" DOUBLE PRECISION,
    "plants" INTEGER,
    "defuses" INTEGER,
    "firstBloods" INTEGER,
    "damageDealt" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValorantPlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValorantPlayerStat_playerStatId_key" ON "ValorantPlayerStat"("playerStatId");

-- AddForeignKey
ALTER TABLE "ValorantPlayerStat" ADD CONSTRAINT "ValorantPlayerStat_playerStatId_fkey" FOREIGN KEY ("playerStatId") REFERENCES "PlayerStat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

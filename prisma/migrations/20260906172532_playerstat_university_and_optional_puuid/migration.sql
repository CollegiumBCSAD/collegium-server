-- AlterTable
ALTER TABLE "PlayerStat" ADD COLUMN     "universityId" TEXT,
ALTER COLUMN "puuid" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE SET NULL ON UPDATE CASCADE;

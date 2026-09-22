-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "streamUrl" TEXT,
ADD COLUMN "streamIsLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "featuredMatchId" TEXT;

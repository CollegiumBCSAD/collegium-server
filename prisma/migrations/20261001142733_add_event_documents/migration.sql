-- CreateEnum
CREATE TYPE "EventDocumentKind" AS ENUM ('COR', 'SCHOOL_ID');

-- CreateTable
CREATE TABLE "EventDocument" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "rosterPlayerId" TEXT NOT NULL,
    "kind" "EventDocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventDocument_teamId_idx" ON "EventDocument"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_teamId_rosterPlayerId_kind_key" ON "EventDocument"("teamId", "rosterPlayerId", "kind");

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "EventTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

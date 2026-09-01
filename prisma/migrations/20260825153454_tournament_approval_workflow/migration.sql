-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'TOURNAMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TOURNAMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'TOURNAMENT_REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TournamentStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "TournamentStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "image" TEXT,
ADD COLUMN     "organizerId" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "EventApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "approvalStatus" "EventApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "rejectionReason" TEXT;

-- Events created before approval existed keep running as they were.
UPDATE "Event" SET "approvalStatus" = 'APPROVED';

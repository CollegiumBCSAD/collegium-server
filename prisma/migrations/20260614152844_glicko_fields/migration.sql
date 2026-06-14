/*
  Warnings:

  - You are about to drop the column `createdAt` on the `University` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "University" DROP COLUMN "createdAt",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "glicko2_rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
ADD COLUMN     "glicko2_rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
ADD COLUMN     "glicko2_sigma" DOUBLE PRECISION NOT NULL DEFAULT 0.06;

-- AlterTable
ALTER TABLE "University" ALTER COLUMN "domain" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UniversityEmail" (
    "email" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniversityEmail_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "UniversityEmail_universityId_idx" ON "UniversityEmail"("universityId");

-- AddForeignKey
ALTER TABLE "UniversityEmail" ADD CONSTRAINT "UniversityEmail_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

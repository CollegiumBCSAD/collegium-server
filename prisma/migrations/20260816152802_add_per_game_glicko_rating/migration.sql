-- CreateTable
CREATE TABLE "UniversityGameRating" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "gameTitle" "GameTitle" NOT NULL,
    "glicko2_rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "glicko2_rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "glicko2_sigma" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversityGameRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniversityGameRating_universityId_gameTitle_key" ON "UniversityGameRating"("universityId", "gameTitle");

-- AddForeignKey
ALTER TABLE "UniversityGameRating" ADD CONSTRAINT "UniversityGameRating_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

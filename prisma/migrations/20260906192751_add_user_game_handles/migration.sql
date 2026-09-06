-- CreateTable
CREATE TABLE "UserGameHandle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameTitle" "GameTitle" NOT NULL,
    "handle" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGameHandle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGameHandle_userId_gameTitle_key" ON "UserGameHandle"("userId", "gameTitle");

-- AddForeignKey
ALTER TABLE "UserGameHandle" ADD CONSTRAINT "UserGameHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

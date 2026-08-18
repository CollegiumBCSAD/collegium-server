-- CreateTable
CREATE TABLE "ScrimChatMessage" (
    "id" TEXT NOT NULL,
    "scrimId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrimChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrimChatMessage_scrimId_createdAt_idx" ON "ScrimChatMessage"("scrimId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScrimChatMessage" ADD CONSTRAINT "ScrimChatMessage_scrimId_fkey" FOREIGN KEY ("scrimId") REFERENCES "Scrim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrimChatMessage" ADD CONSTRAINT "ScrimChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

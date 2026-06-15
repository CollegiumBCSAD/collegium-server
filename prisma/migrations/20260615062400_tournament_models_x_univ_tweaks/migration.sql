-- CreateTable
CREATE TABLE "_TournamentToUniversity" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TournamentToUniversity_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TournamentToUniversity_B_index" ON "_TournamentToUniversity"("B");

-- AddForeignKey
ALTER TABLE "_TournamentToUniversity" ADD CONSTRAINT "_TournamentToUniversity_A_fkey" FOREIGN KEY ("A") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TournamentToUniversity" ADD CONSTRAINT "_TournamentToUniversity_B_fkey" FOREIGN KEY ("B") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

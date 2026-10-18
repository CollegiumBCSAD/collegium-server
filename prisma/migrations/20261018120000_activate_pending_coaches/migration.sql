-- Coach/Manager accounts no longer go through admin approval. Activate the
-- ones still waiting in the old queue so they can sign in.
UPDATE "User" SET "status" = 'ACTIVE' WHERE "role" = 'COACH' AND "status" = 'PENDING';

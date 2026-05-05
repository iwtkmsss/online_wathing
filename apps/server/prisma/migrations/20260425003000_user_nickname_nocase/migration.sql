CREATE UNIQUE INDEX IF NOT EXISTS "User_nickname_nocase_key"
ON "User"("nickname" COLLATE NOCASE);

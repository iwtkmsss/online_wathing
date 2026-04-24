/*
  Warnings:

  - Added the required column `libraryKey` to the `Media` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "filePath" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "durationSeconds" REAL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "missingSince" DATETIME,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "parentId" TEXT,
    CONSTRAINT "Media_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("createdAt", "description", "durationSeconds", "episodeNumber", "filePath", "id", "mimeType", "parentId", "seasonNumber", "sizeBytes", "title", "type", "updatedAt") SELECT "createdAt", "description", "durationSeconds", "episodeNumber", "filePath", "id", "mimeType", "parentId", "seasonNumber", "sizeBytes", "title", "type", "updatedAt" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE UNIQUE INDEX "Media_libraryKey_key" ON "Media"("libraryKey");
CREATE UNIQUE INDEX "Media_filePath_key" ON "Media"("filePath");
CREATE INDEX "Media_type_idx" ON "Media"("type");
CREATE INDEX "Media_parentId_idx" ON "Media"("parentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_scenarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "months" TEXT NOT NULL DEFAULT '["JUL","AGO","SET","OUT","NOV","DEZ"]',
    "bridgeMonths" TEXT NOT NULL DEFAULT '["Janeiro/2027","Fevereiro/2027","Março/2027"]'
);
INSERT INTO "new_scenarios" ("createdAt", "id", "isBase", "name", "updatedAt") SELECT "createdAt", "id", "isBase", "name", "updatedAt" FROM "scenarios";
DROP TABLE "scenarios";
ALTER TABLE "new_scenarios" RENAME TO "scenarios";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

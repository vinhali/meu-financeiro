/*
  Warnings:

  - You are about to drop the column `isReserve` on the `line_items` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_line_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "obs" TEXT NOT NULL DEFAULT '',
    "applyDissidio" BOOLEAN NOT NULL DEFAULT false,
    "excludeFromBridge" BOOLEAN NOT NULL DEFAULT false,
    "values" TEXT NOT NULL,
    CONSTRAINT "line_items_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_line_items" ("applyDissidio", "excludeFromBridge", "id", "name", "obs", "order", "scenarioId", "section", "values") SELECT "applyDissidio", "excludeFromBridge", "id", "name", "obs", "order", "scenarioId", "section", "values" FROM "line_items";
DROP TABLE "line_items";
ALTER TABLE "new_line_items" RENAME TO "line_items";
CREATE INDEX "line_items_scenarioId_idx" ON "line_items"("scenarioId");
CREATE TABLE "new_scenarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "months" TEXT NOT NULL DEFAULT '["JUL","AGO","SET","OUT","NOV","DEZ"]',
    "bridgeMonths" TEXT NOT NULL DEFAULT '["Janeiro/2027","Fevereiro/2027","Março/2027"]',
    "emergencyReserve" REAL NOT NULL DEFAULT 0
);
INSERT INTO "new_scenarios" ("bridgeMonths", "createdAt", "id", "isBase", "months", "name", "updatedAt") SELECT "bridgeMonths", "createdAt", "id", "isBase", "months", "name", "updatedAt" FROM "scenarios";
DROP TABLE "scenarios";
ALTER TABLE "new_scenarios" RENAME TO "scenarios";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
    "isReserve" BOOLEAN NOT NULL DEFAULT false,
    "applyDissidio" BOOLEAN NOT NULL DEFAULT false,
    "excludeFromBridge" BOOLEAN NOT NULL DEFAULT false,
    "values" TEXT NOT NULL,
    CONSTRAINT "line_items_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_line_items" ("id", "isReserve", "name", "obs", "order", "scenarioId", "section", "values") SELECT "id", "isReserve", "name", "obs", "order", "scenarioId", "section", "values" FROM "line_items";
DROP TABLE "line_items";
ALTER TABLE "new_line_items" RENAME TO "line_items";
CREATE INDEX "line_items_scenarioId_idx" ON "line_items"("scenarioId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

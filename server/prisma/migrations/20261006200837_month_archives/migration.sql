-- CreateTable
CREATE TABLE "month_archives" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "month" TEXT,
    "position" INTEGER NOT NULL,
    "rows" TEXT NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "month_archives_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "month_archives_scenarioId_idx" ON "month_archives"("scenarioId");

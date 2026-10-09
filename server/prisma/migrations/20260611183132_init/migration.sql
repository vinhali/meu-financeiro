-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "line_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "obs" TEXT NOT NULL DEFAULT '',
    "isReserve" BOOLEAN NOT NULL DEFAULT false,
    "values" TEXT NOT NULL,
    CONSTRAINT "line_items_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "severityLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" TEXT NOT NULL,
    "balanceNote" TEXT NOT NULL DEFAULT '',
    "installment" TEXT NOT NULL DEFAULT '',
    "rate" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ativa',
    CONSTRAINT "debts_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bridges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "plr" REAL NOT NULL DEFAULT 0,
    "dissidioPercent" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "bridges_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "line_items_scenarioId_idx" ON "line_items"("scenarioId");

-- CreateIndex
CREATE INDEX "debts_scenarioId_idx" ON "debts"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "bridges_scenarioId_key" ON "bridges"("scenarioId");

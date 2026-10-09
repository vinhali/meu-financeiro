-- CreateTable
CREATE TABLE "scenario_texts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "scenario_texts_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "scenario_texts_scenarioId_key_key" ON "scenario_texts"("scenarioId", "key");

-- CreateTable
CREATE TABLE "paid_marks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "markedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "paid_marks_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "line_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "paid_marks_itemId_month_key" ON "paid_marks"("itemId", "month");

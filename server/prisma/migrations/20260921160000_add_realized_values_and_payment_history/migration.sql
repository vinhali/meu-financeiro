ALTER TABLE "line_items" ADD COLUMN "actualValues" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "debts" ADD COLUMN "dueDay" INTEGER;

CREATE TABLE "debt_payments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "debtId" TEXT NOT NULL,
  "paidAt" DATETIME NOT NULL,
  "amount" REAL NOT NULL,
  "installment" INTEGER,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_payments_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "debt_payments_debtId_paidAt_idx" ON "debt_payments"("debtId", "paidAt");

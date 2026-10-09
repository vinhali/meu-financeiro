-- CreateTable
CREATE TABLE "of_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectorId" INTEGER NOT NULL,
    "connectorName" TEXT NOT NULL,
    "connectorImageUrl" TEXT,
    "status" TEXT NOT NULL,
    "executionStatus" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "consentExpiresAt" DATETIME,
    "providerUpdatedAt" DATETIME,
    "nextAutoSyncAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "raw" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "of_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketingName" TEXT,
    "number" TEXT,
    "ownerName" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "balanceCents" BIGINT NOT NULL,
    "creditLimitCents" BIGINT,
    "availableCreditLimitCents" BIGINT,
    "minimumPaymentCents" BIGINT,
    "balanceCloseDate" DATETIME,
    "balanceDueDate" DATETIME,
    "cardBrand" TEXT,
    "raw" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "of_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "of_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "of_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "descriptionRaw" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "amountInAccountCurrencyCents" BIGINT,
    "balanceCents" BIGINT,
    "category" TEXT,
    "categoryId" TEXT,
    "operationType" TEXT,
    "providerCode" TEXT,
    "billId" TEXT,
    "installmentNumber" INTEGER,
    "totalInstallments" INTEGER,
    "purchaseDate" DATETIME,
    "merchantName" TEXT,
    "merchantCnpj" TEXT,
    "counterpartyName" TEXT,
    "counterpartyDocument" TEXT,
    "paymentMethod" TEXT,
    "raw" TEXT NOT NULL,
    "providerCreatedAt" DATETIME,
    "providerUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "of_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "of_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "of_credit_card_bills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "closingDate" DATETIME,
    "totalAmountCents" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "minimumPaymentCents" BIGINT,
    "allowsInstallments" BOOLEAN,
    "raw" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "of_credit_card_bills_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "of_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "of_investments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isin" TEXT,
    "number" TEXT,
    "issuer" TEXT,
    "status" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "balanceCents" BIGINT NOT NULL,
    "amountOriginalCents" BIGINT,
    "amountProfitCents" BIGINT,
    "quantity" REAL,
    "unitValue" REAL,
    "rate" REAL,
    "rateType" TEXT,
    "purchaseDate" DATETIME,
    "dueDate" DATETIME,
    "raw" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "of_investments_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "of_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "of_loans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "contractNumber" TEXT,
    "productName" TEXT,
    "type" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "contractAmountCents" BIGINT,
    "outstandingBalanceCents" BIGINT,
    "cet" REAL,
    "totalInstallments" INTEGER,
    "paidInstallments" INTEGER,
    "dueInstallments" INTEGER,
    "pastDueInstallments" INTEGER,
    "contractDate" DATETIME,
    "dueDate" DATETIME,
    "raw" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "of_loans_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "of_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "of_sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "stats" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    CONSTRAINT "of_sync_runs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "of_connections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "of_accounts_connectionId_idx" ON "of_accounts"("connectionId");

-- CreateIndex
CREATE INDEX "of_transactions_accountId_date_idx" ON "of_transactions"("accountId", "date");

-- CreateIndex
CREATE INDEX "of_transactions_date_idx" ON "of_transactions"("date");

-- CreateIndex
CREATE INDEX "of_transactions_categoryId_idx" ON "of_transactions"("categoryId");

-- CreateIndex
CREATE INDEX "of_transactions_billId_idx" ON "of_transactions"("billId");

-- CreateIndex
CREATE INDEX "of_credit_card_bills_accountId_dueDate_idx" ON "of_credit_card_bills"("accountId", "dueDate");

-- CreateIndex
CREATE INDEX "of_investments_connectionId_idx" ON "of_investments"("connectionId");

-- CreateIndex
CREATE INDEX "of_loans_connectionId_idx" ON "of_loans"("connectionId");

-- CreateIndex
CREATE INDEX "of_sync_runs_startedAt_idx" ON "of_sync_runs"("startedAt");

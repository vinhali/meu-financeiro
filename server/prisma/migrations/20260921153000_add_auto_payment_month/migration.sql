ALTER TABLE "scenarios" ADD COLUMN "lastAutoPaymentMonth" TEXT;

UPDATE "scenarios"
SET "lastAutoPaymentMonth" = strftime('%Y-%m', 'now')
WHERE "lastAutoPaymentMonth" IS NULL;

-- AlterTable
ALTER TABLE "SystemSetupState" ADD COLUMN IF NOT EXISTS "panelDomain" TEXT;
ALTER TABLE "SystemSetupState" ADD COLUMN IF NOT EXISTS "panelUrl" TEXT;

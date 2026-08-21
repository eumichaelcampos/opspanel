-- AlterTable
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "wpInventorySnapshot" JSONB;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "wpInventoryObservedAt" TIMESTAMP(3);

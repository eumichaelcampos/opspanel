-- AlterTable
ALTER TABLE "Server" ADD COLUMN IF NOT EXISTS "securitySnapshot" JSONB;
ALTER TABLE "Server" ADD COLUMN IF NOT EXISTS "securityObservedAt" TIMESTAMP(3);

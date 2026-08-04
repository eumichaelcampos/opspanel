-- AlterTable
ALTER TABLE "Server" ADD COLUMN "healthSnapshot" JSONB;
ALTER TABLE "Server" ADD COLUMN "healthObservedAt" TIMESTAMP(3);

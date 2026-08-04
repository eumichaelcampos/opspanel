-- AlterTable
ALTER TABLE "Server" ADD COLUMN "metricsSnapshot" JSONB;
ALTER TABLE "Server" ADD COLUMN "metricsObservedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Server" ADD COLUMN "onboardingSnapshot" JSONB;
ALTER TABLE "Server" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

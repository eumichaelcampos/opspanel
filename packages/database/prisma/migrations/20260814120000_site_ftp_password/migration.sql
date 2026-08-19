-- AlterTable
ALTER TABLE "SiteFtpUser" ADD COLUMN IF NOT EXISTS "passwordEnc" JSONB;

-- Google Drive + política de backup por site

DO $$ BEGIN
  ALTER TYPE "UserSecretKind" ADD VALUE 'google_drive';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BackupContents" AS ENUM ('files_and_database', 'files_only', 'database_only');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BackupSchedule" AS ENUM ('off', 'daily', 'every_12h', 'weekly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "SystemSetupState"
  ADD COLUMN IF NOT EXISTS "googleDriveClientId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleDriveClientSecretCipher" TEXT,
  ADD COLUMN IF NOT EXISTS "googleDriveClientSecretIv" TEXT,
  ADD COLUMN IF NOT EXISTS "googleDriveClientSecretAuthTag" TEXT;

CREATE TABLE IF NOT EXISTS "SiteBackupPolicy" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contents" "BackupContents" NOT NULL DEFAULT 'files_and_database',
  "keepLocal" INTEGER NOT NULL DEFAULT 7,
  "schedule" "BackupSchedule" NOT NULL DEFAULT 'off',
  "scheduleHour" INTEGER NOT NULL DEFAULT 3,
  "uploadToDrive" BOOLEAN NOT NULL DEFAULT false,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteBackupPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SiteBackupPolicy_siteId_key" ON "SiteBackupPolicy"("siteId");
CREATE INDEX IF NOT EXISTS "SiteBackupPolicy_nextRunAt_idx" ON "SiteBackupPolicy"("nextRunAt");

DO $$ BEGIN
  ALTER TABLE "SiteBackupPolicy"
    ADD CONSTRAINT "SiteBackupPolicy_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

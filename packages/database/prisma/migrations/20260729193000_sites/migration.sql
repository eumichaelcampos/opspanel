-- AlterTable
ALTER TABLE "Server" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('unknown', 'active', 'disabled', 'provisioning', 'failed');

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "siteType" TEXT,
    "phpVersion" TEXT,
    "cacheBackend" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'unknown',
    "isEnabled" BOOLEAN,
    "lastObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Site_organizationId_domain_key" ON "Site"("organizationId", "domain");
CREATE INDEX "Site_serverId_idx" ON "Site"("serverId");

ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Site" ADD CONSTRAINT "Site_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

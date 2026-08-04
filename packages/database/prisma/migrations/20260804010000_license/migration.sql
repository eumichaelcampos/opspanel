-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('active', 'grace', 'expired', 'suspended');

-- CreateTable
CREATE TABLE "LicenseState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "instanceId" TEXT NOT NULL,
    "licenseKeyHash" TEXT,
    "plan" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'active',
    "entitlements" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseState_instanceId_key" ON "LicenseState"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_metric_period_key" ON "UsageCounter"("metric", "period");

-- CreateIndex
CREATE INDEX "UsageCounter_period_idx" ON "UsageCounter"("period");

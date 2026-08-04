-- CreateTable
CREATE TABLE "SystemUpdateState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "currentVersion" TEXT NOT NULL,
    "latestVersion" TEXT,
    "latestChangelog" TEXT,
    "latestReleaseUrl" TEXT,
    "updateAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "applyStatus" TEXT NOT NULL DEFAULT 'idle',
    "applyLog" TEXT,
    "applyStartedAt" TIMESTAMP(3),
    "applyFinishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemUpdateState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserUpdateDismissal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserUpdateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserUpdateDismissal_userId_version_key" ON "UserUpdateDismissal"("userId", "version");

-- CreateIndex
CREATE INDEX "UserUpdateDismissal_userId_idx" ON "UserUpdateDismissal"("userId");

-- AddForeignKey
ALTER TABLE "UserUpdateDismissal" ADD CONSTRAINT "UserUpdateDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

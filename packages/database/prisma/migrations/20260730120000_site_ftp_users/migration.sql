-- CreateTable
CREATE TABLE "SiteFtpUser" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "homePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteFtpUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteFtpUser_siteId_username_key" ON "SiteFtpUser"("siteId", "username");

-- CreateIndex
CREATE INDEX "SiteFtpUser_siteId_idx" ON "SiteFtpUser"("siteId");

-- AddForeignKey
ALTER TABLE "SiteFtpUser" ADD CONSTRAINT "SiteFtpUser_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

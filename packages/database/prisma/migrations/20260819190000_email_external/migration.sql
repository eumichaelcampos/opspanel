-- CreateEnum
CREATE TYPE "EmailDomainStatus" AS ENUM ('draft', 'pending_dns', 'active', 'error');

-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('atriomail', 'resend');

-- CreateTable
CREATE TABLE "EmailDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "domain" TEXT NOT NULL,
    "provider" "EmailProviderKind" NOT NULL DEFAULT 'atriomail',
    "providerDomainId" TEXT,
    "status" "EmailDomainStatus" NOT NULL DEFAULT 'draft',
    "webmailUrl" TEXT,
    "dnsBundle" JSONB,
    "lastHealthAt" TIMESTAMP(3),
    "healthSnapshot" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMailbox" (
    "id" TEXT NOT NULL,
    "emailDomainId" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "displayName" TEXT,
    "providerMailboxId" TEXT,
    "quotaMb" INTEGER NOT NULL DEFAULT 10240,
    "status" TEXT NOT NULL DEFAULT 'active',
    "imapHost" TEXT,
    "smtpHost" TEXT,
    "webmailUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSmtpProfile" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "emailDomainId" TEXT,
    "provider" "EmailProviderKind" NOT NULL DEFAULT 'resend',
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "providerRef" TEXT,
    "wpConfigured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSmtpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_siteId_key" ON "EmailDomain"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDomain_organizationId_domain_key" ON "EmailDomain"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "EmailDomain_organizationId_idx" ON "EmailDomain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMailbox_emailDomainId_localPart_key" ON "EmailMailbox"("emailDomainId", "localPart");

-- CreateIndex
CREATE INDEX "EmailMailbox_emailDomainId_idx" ON "EmailMailbox"("emailDomainId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSmtpProfile_siteId_key" ON "EmailSmtpProfile"("siteId");

-- AddForeignKey
ALTER TABLE "EmailDomain" ADD CONSTRAINT "EmailDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDomain" ADD CONSTRAINT "EmailDomain_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMailbox" ADD CONSTRAINT "EmailMailbox_emailDomainId_fkey" FOREIGN KEY ("emailDomainId") REFERENCES "EmailDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSmtpProfile" ADD CONSTRAINT "EmailSmtpProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSmtpProfile" ADD CONSTRAINT "EmailSmtpProfile_emailDomainId_fkey" FOREIGN KEY ("emailDomainId") REFERENCES "EmailDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

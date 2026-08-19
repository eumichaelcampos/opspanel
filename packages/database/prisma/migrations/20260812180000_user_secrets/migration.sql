-- CreateEnum
CREATE TYPE "UserSecretKind" AS ENUM ('openai_api_key');

-- CreateTable
CREATE TABLE "UserSecret" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "UserSecretKind" NOT NULL,
    "label" TEXT,
    "hint" TEXT,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSecret_userId_idx" ON "UserSecret"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSecret_userId_kind_key" ON "UserSecret"("userId", "kind");

-- AddForeignKey
ALTER TABLE "UserSecret" ADD CONSTRAINT "UserSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

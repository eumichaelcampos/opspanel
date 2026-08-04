-- CreateTable
CREATE TABLE "SystemSetupState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetupState_pkey" PRIMARY KEY ("id")
);

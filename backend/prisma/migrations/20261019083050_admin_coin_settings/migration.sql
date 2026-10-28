-- CreateTable
CREATE TABLE "CoinSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "coinsPerInterval" INTEGER NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "maxPerSession" INTEGER NOT NULL,
    "maxPerDay" INTEGER NOT NULL,
    "coinsPerEtb" INTEGER NOT NULL,
    "minRedeem" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinSettings_pkey" PRIMARY KEY ("id")
);

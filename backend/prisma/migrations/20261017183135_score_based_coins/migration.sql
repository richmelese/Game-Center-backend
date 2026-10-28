-- CreateEnum
CREATE TYPE "CoinMode" AS ENUM ('TIME', 'SCORE');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "coinMode" "CoinMode" NOT NULL DEFAULT 'TIME',
ADD COLUMN     "pointsPerCoin" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "resultSecret" TEXT;

-- AlterTable
ALTER TABLE "PlaySession" ADD COLUMN     "coinMode" "CoinMode" NOT NULL DEFAULT 'TIME';

-- CreateTable
CREATE TABLE "GameResult" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" INTEGER,
    "won" BOOLEAN,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameResult_sessionId_idx" ON "GameResult"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GameResult_gameId_resultId_key" ON "GameResult"("gameId", "resultId");

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlaySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PositionDirection" AS ENUM ('long', 'short');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cash" DOUBLE PRECISION NOT NULL,
    "startingCapital" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liquidated" BOOLEAN NOT NULL DEFAULT false,
    "peakNav" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "fundId" INTEGER NOT NULL,
    "ticker" TEXT NOT NULL,
    "direction" "PositionDirection" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "entryTimestamp" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "exitPrice" DOUBLE PRECISION,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketTick" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotJson" TEXT NOT NULL,

    CONSTRAINT "MarketTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketEventLog" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "ticker" TEXT,
    "headline" TEXT NOT NULL,
    "priceImpactPercent" DOUBLE PRECISION NOT NULL,
    "tickCountAt" INTEGER,

    CONSTRAINT "MarketEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RivalDecisionLog" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "fundId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "ticker" TEXT,
    "reasoning" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "fillPrice" DOUBLE PRECISION,
    "realizedPnL" DOUBLE PRECISION,
    "tickCountAt" INTEGER,

    CONSTRAINT "RivalDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidationLog" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "fundId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startingCapital" DOUBLE PRECISION NOT NULL,
    "peakNav" DOUBLE PRECISION NOT NULL,
    "finalNav" DOUBLE PRECISION NOT NULL,
    "cause" TEXT NOT NULL,
    "rivalContext" TEXT,
    "tickCountAt" INTEGER NOT NULL,
    "durationTicks" INTEGER NOT NULL,

    CONSTRAINT "LiquidationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "World_name_key" ON "World"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_worldId_name_key" ON "Fund"("worldId", "name");

-- CreateIndex
CREATE INDEX "Position_fundId_closedAt_idx" ON "Position"("fundId", "closedAt");

-- CreateIndex
CREATE INDEX "MarketTick_worldId_timestamp_idx" ON "MarketTick"("worldId", "timestamp");

-- CreateIndex
CREATE INDEX "MarketEventLog_worldId_timestamp_idx" ON "MarketEventLog"("worldId", "timestamp");

-- CreateIndex
CREATE INDEX "RivalDecisionLog_worldId_timestamp_idx" ON "RivalDecisionLog"("worldId", "timestamp");

-- CreateIndex
CREATE INDEX "LiquidationLog_fundId_idx" ON "LiquidationLog"("fundId");

-- CreateIndex
CREATE INDEX "LiquidationLog_worldId_timestamp_idx" ON "LiquidationLog"("worldId", "timestamp");

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketTick" ADD CONSTRAINT "MarketTick_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketEventLog" ADD CONSTRAINT "MarketEventLog_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RivalDecisionLog" ADD CONSTRAINT "RivalDecisionLog_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RivalDecisionLog" ADD CONSTRAINT "RivalDecisionLog_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidationLog" ADD CONSTRAINT "LiquidationLog_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidationLog" ADD CONSTRAINT "LiquidationLog_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;


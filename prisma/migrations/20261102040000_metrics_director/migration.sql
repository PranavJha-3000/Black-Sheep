-- CreateTable
CREATE TABLE "FundNavSnapshot" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "fundId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tickCountAt" INTEGER NOT NULL,
    "nav" DOUBLE PRECISION NOT NULL,
    "grossExposure" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FundNavSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorDecisionLog" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tickCountAt" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sector" TEXT,
    "rationale" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL,
    "eventHeadline" TEXT,

    CONSTRAINT "DirectorDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundNavSnapshot_fundId_id_idx" ON "FundNavSnapshot"("fundId", "id");

-- CreateIndex
CREATE INDEX "DirectorDecisionLog_worldId_id_idx" ON "DirectorDecisionLog"("worldId", "id");

-- AddForeignKey
ALTER TABLE "FundNavSnapshot" ADD CONSTRAINT "FundNavSnapshot_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundNavSnapshot" ADD CONSTRAINT "FundNavSnapshot_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorDecisionLog" ADD CONSTRAINT "DirectorDecisionLog_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "hasModelBrains" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ExperimentDecision" (
    "id" SERIAL NOT NULL,
    "experimentId" INTEGER NOT NULL,
    "arm" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "tick" INTEGER NOT NULL,
    "fundKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "action" TEXT NOT NULL,
    "ticker" TEXT,
    "dollarAmount" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "toolCallsJson" TEXT NOT NULL,
    "outcome" TEXT,

    CONSTRAINT "ExperimentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentDecision_experimentId_arm_seed_tick_idx" ON "ExperimentDecision"("experimentId", "arm", "seed", "tick");

-- AddForeignKey
ALTER TABLE "ExperimentDecision" ADD CONSTRAINT "ExperimentDecision_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


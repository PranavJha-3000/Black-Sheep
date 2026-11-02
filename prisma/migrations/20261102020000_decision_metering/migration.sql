-- AlterTable
ALTER TABLE "RivalDecisionLog" ADD COLUMN     "llmCallId" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'policy';

-- CreateTable
CREATE TABLE "LlmCallLog" (
    "id" SERIAL NOT NULL,
    "worldId" INTEGER NOT NULL,
    "fundId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "servedBy" TEXT,
    "purpose" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "error" TEXT,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCallLog" (
    "id" SERIAL NOT NULL,
    "llmCallId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,

    CONSTRAINT "ToolCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallLog_fundId_timestamp_idx" ON "LlmCallLog"("fundId", "timestamp");

-- CreateIndex
CREATE INDEX "LlmCallLog_worldId_timestamp_idx" ON "LlmCallLog"("worldId", "timestamp");

-- CreateIndex
CREATE INDEX "ToolCallLog_llmCallId_idx" ON "ToolCallLog"("llmCallId");

-- CreateIndex
CREATE INDEX "RivalDecisionLog_fundId_timestamp_idx" ON "RivalDecisionLog"("fundId", "timestamp");

-- AddForeignKey
ALTER TABLE "RivalDecisionLog" ADD CONSTRAINT "RivalDecisionLog_llmCallId_fkey" FOREIGN KEY ("llmCallId") REFERENCES "LlmCallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCallLog" ADD CONSTRAINT "LlmCallLog_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCallLog" ADD CONSTRAINT "LlmCallLog_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCallLog" ADD CONSTRAINT "ToolCallLog_llmCallId_fkey" FOREIGN KEY ("llmCallId") REFERENCES "LlmCallLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "Experiment" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "variable" TEXT NOT NULL,
    "specJson" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_status_id_idx" ON "Experiment"("status", "id");


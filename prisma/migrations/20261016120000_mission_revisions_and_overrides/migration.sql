-- Mission revisions (linked missions; originals are never mutated) and policy override requests.

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN "revisedFromId" TEXT,
ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "PolicyOverrideRequest" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "missionVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "challengedChecks" JSONB NOT NULL,
    "currentBudgetMinor" INTEGER NOT NULL,
    "proposedBudgetMinor" INTEGER,
    "currency" TEXT NOT NULL,
    "proposedChange" TEXT,
    "justification" TEXT NOT NULL,
    "status" "OverrideStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyOverrideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mission_revisedFromId_idx" ON "Mission"("revisedFromId");
CREATE INDEX "PolicyOverrideRequest_missionId_status_idx" ON "PolicyOverrideRequest"("missionId", "status");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_revisedFromId_fkey" FOREIGN KEY ("revisedFromId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyOverrideRequest" ADD CONSTRAINT "PolicyOverrideRequest_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyOverrideRequest" ADD CONSTRAINT "PolicyOverrideRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyOverrideRequest" ADD CONSTRAINT "PolicyOverrideRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants Prisma cannot express.
CREATE UNIQUE INDEX "PolicyOverrideRequest_one_pending_per_mission"
  ON "PolicyOverrideRequest" ("missionId") WHERE "status" = 'PENDING_REVIEW';
ALTER TABLE "PolicyOverrideRequest" ADD CONSTRAINT "PolicyOverrideRequest_justification_len"
  CHECK (char_length("justification") BETWEEN 20 AND 2000);
-- Separation of duties at the storage layer: nobody reviews their own request.
ALTER TABLE "PolicyOverrideRequest" ADD CONSTRAINT "PolicyOverrideRequest_no_self_review"
  CHECK ("reviewedById" IS NULL OR "reviewedById" <> "requestedById");
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_revision_not_self"
  CHECK ("revisedFromId" IS NULL OR "revisedFromId" <> "id");

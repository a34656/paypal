/*
  Warnings:

  - Added the required column `fingerprint` to the `Approval` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "fingerprint" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Approval_fingerprint_createdAt_idx" ON "Approval"("fingerprint", "createdAt");

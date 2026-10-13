-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('DEMO', 'SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'APPROVER');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('CREATED', 'PARSED', 'CONFIRMED', 'SCOUTING', 'SCOUTED', 'RISK_ANALYSIS', 'OPTIMIZING', 'POLICY_EVALUATION', 'AWAITING_APPROVAL', 'BLOCKED', 'READY_FOR_CHECKOUT', 'FAILED', 'EXPIRED', 'DENIED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_STARTED', 'PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED', 'CHECKOUT_PENDING', 'CAPTURE_PENDING', 'CAPTURED', 'CAPTURE_PROVIDER_PENDING', 'FAILED', 'CANCELLED', 'BLOCKED', 'EXPIRED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('AUTHORIZATION', 'APPROVER_APPROVAL');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW_CHECKOUT', 'REQUIRE_APPROVAL', 'BLOCK');

-- CreateEnum
CREATE TYPE "SellerVerification" AS ENUM ('VERIFIED', 'UNVERIFIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "demoIdentity" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "roles" "Role"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rawInputText" TEXT NOT NULL,
    "parsedProposal" JSONB,
    "parserSource" TEXT,
    "confirmedConstraints" JSONB,
    "budgetMinor" INTEGER,
    "currency" TEXT,
    "quantity" INTEGER,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "mode" "Mode" NOT NULL,
    "policyVersion" INTEGER,
    "decision" "PolicyDecision",
    "recommendedProductId" TEXT,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "shippingMinor" INTEGER,
    "taxMinor" INTEGER,
    "currency" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sellerId" TEXT,
    "sellerName" TEXT,
    "sellerVerificationStatus" "SellerVerification" NOT NULL DEFAULT 'UNKNOWN',
    "shippingEstimateDays" INTEGER,
    "stockQuantity" INTEGER,
    "attributes" JSONB NOT NULL,
    "isDemoData" BOOLEAN NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionProduct" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalMinor" INTEGER,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "evidenceCoverage" INTEGER,
    "riskEvidence" JSONB,
    "eligible" BOOLEAN,
    "ineligibleReasons" JSONB,
    "recommendationRank" INTEGER,
    "optimizerScore" INTEGER,
    "optimizerExplanation" TEXT,
    "policyDecision" "PolicyDecision",
    "policyResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "decisionAtApproval" "PolicyDecision" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "approvedAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "providerOrderId" TEXT,
    "providerCaptureId" TEXT,
    "providerStatus" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "shippingMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "itemTotalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "statusReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "captureRequestId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "requestIds" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedOrder" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "captureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulatedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "result" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "inputSummary" JSONB,
    "outputSummary" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "missionId" TEXT,
    "ownerId" TEXT,
    "actor" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "mode" "Mode" NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_demoIdentity_key" ON "User"("demoIdentity");

-- CreateIndex
CREATE INDEX "Mission_ownerId_createdAt_idx" ON "Mission"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_provider_providerProductId_key" ON "Product"("provider", "providerProductId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionProduct_missionId_productId_key" ON "MissionProduct"("missionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_ownerId_version_key" ON "Policy"("ownerId", "version");

-- CreateIndex
CREATE INDEX "Approval_missionId_status_idx" ON "Approval"("missionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_captureRequestId_key" ON "Payment"("captureRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceId_key" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_missionId_status_idx" ON "Payment"("missionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedOrder_paymentId_key" ON "SimulatedOrder"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key" ON "WebhookEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "AgentRun_agentType_startedAt_idx" ON "AgentRun"("agentType", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_missionId_step_key" ON "AgentRun"("missionId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_missionId_seq_idx" ON "AuditEvent"("missionId", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_ownerId_seq_idx" ON "AuditEvent"("ownerId", "seq");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProduct" ADD CONSTRAINT "MissionProduct_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProduct" ADD CONSTRAINT "MissionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Authorization holds (spend cap), human settlement, and refunds.

ALTER TYPE "PaymentStatus" ADD VALUE 'AUTHORIZE_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE 'SETTLE_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

ALTER TABLE "MissionProduct" ADD COLUMN "amountBasis" TEXT, ADD COLUMN "allowanceMinor" INTEGER;

ALTER TABLE "Payment"
  ADD COLUMN "allowanceMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'CAPTURE',
  ADD COLUMN "providerAuthorizationId" TEXT,
  ADD COLUMN "authorizationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "settledMinor" INTEGER,
  ADD COLUMN "settleRequestId" TEXT,
  ADD COLUMN "refundedMinor" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Payment_settleRequestId_key" ON "Payment"("settleRequestId");

-- The breakdown now includes the allowance (0 for exact-amount payments).
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_amount_breakdown";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_breakdown"
  CHECK ("amountMinor" = "itemTotalMinor" + "shippingMinor" + "taxMinor" + "allowanceMinor");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_intent_valid" CHECK ("intent" IN ('CAPTURE', 'AUTHORIZE'));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settle_within_cap"
  CHECK ("settledMinor" IS NULL OR ("settledMinor" > 0 AND "settledMinor" <= "amountMinor"));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_within_capture"
  CHECK ("refundedMinor" >= 0 AND "refundedMinor" <= COALESCE("settledMinor", "amountMinor"));

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "providerRefundId" TEXT,
  "status" TEXT NOT NULL,
  "statusReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "Refund_requestId_key" ON "Refund"("requestId");
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
CREATE INDEX "Refund_paymentId_createdAt_idx" ON "Refund"("paymentId", "createdAt");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

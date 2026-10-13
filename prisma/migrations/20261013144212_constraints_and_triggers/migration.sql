-- Constraints Prisma cannot express in schema.prisma.

-- Invariant: at most one ACTIVE approval per mission.
CREATE UNIQUE INDEX "Approval_one_active_per_mission"
  ON "Approval" ("missionId") WHERE "status" = 'ACTIVE';

-- Invariant: one mission = one purchase. At most one live-or-successful payment per mission.
-- Terminal failure states (FAILED, CANCELLED, BLOCKED, EXPIRED) free the slot for a retry.
CREATE UNIQUE INDEX "Payment_one_live_per_mission"
  ON "Payment" ("missionId")
  WHERE "status" NOT IN ('FAILED', 'CANCELLED', 'BLOCKED', 'EXPIRED');

-- Money sanity at the storage layer (defence in depth; the app validates first).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_breakdown"
  CHECK ("amountMinor" = "itemTotalMinor" + "shippingMinor" + "taxMinor");
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_amount_positive" CHECK ("approvedAmountMinor" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonneg" CHECK ("unitPriceMinor" >= 0);

-- Append-only enforcement for the audit log and policy history.
CREATE OR REPLACE FUNCTION aegis_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AEGIS: table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION aegis_reject_mutation();

CREATE TRIGGER "Policy_append_only"
  BEFORE UPDATE OR DELETE ON "Policy"
  FOR EACH ROW EXECUTE FUNCTION aegis_reject_mutation();

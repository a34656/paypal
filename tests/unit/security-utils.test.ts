import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv } from "@/lib/csv";
import { redact, scrubString } from "@/lib/redact";
import { EnvValidationError, parseEnv, PAYPAL_LIVE_HOST, PAYPAL_SANDBOX_HOST } from "@/lib/env";
import { csrfTokenFor, signSession, verifyCsrf, verifySession } from "@/lib/session-crypto";

describe("CSV formula-injection escaping", () => {
  it("prefixes dangerous leading characters", () => {
    for (const s of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) expect(escapeCsvCell(s).startsWith("'")).toBe(true);
    expect(escapeCsvCell("Raspberry Pi")).toBe("Raspberry Pi");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(1767)).toBe("1767");
  });
  it("quotes RFC-4180 fields", () => {
    expect(toCsv([{ a: 'x,"y"', b: "=cmd" }], ["a", "b"])).toBe('a,b\r\n"x,""y""",\'=cmd');
  });
});

describe("allowlist redactor", () => {
  it("drops non-allowlisted keys and scrubs credentials", () => {
    const out = redact({ reason: "Bearer abc.def.ghi failed", client_secret: "s3cr3t", authorization: "Basic Zm9vOmJhcg==", nested: { x: 1 }, amountMinor: 5 });
    expect(out).toEqual({ reason: "[REDACTED] failed", amountMinor: 5, _redactedKeys: 3 });
  });
  it("scrubs configured secret values wherever they appear", () => {
    process.env.PAYPAL_CLIENT_SECRET = "SUPERSECRETVALUE123";
    expect(scrubString("error with SUPERSECRETVALUE123 inside")).toBe("error with [REDACTED] inside");
    delete process.env.PAYPAL_CLIENT_SECRET;
  });
  it("truncates long strings", () => {
    expect((redact({ reason: "x".repeat(2000) }).reason as string).length).toBeLessThanOrEqual(501);
  });
});

describe("boot-time env validation", () => {
  const base = { DATABASE_URL: "postgresql://x", NODE_ENV: "development" };
  it("defaults to sandbox and demo mode", () => {
    const env = parseEnv(base);
    expect(env.paypal.baseUrl).toBe(PAYPAL_SANDBOX_HOST);
    expect(env.paypal.configured).toBe(false);
  });
  it("refuses hosts outside the allowlist", () => {
    expect(() => parseEnv({ ...base, PAYPAL_BASE_URL: "https://evil.example.com" })).toThrow(EnvValidationError);
  });
  it("refuses the live host without both live flags", () => {
    expect(() => parseEnv({ ...base, PAYPAL_BASE_URL: PAYPAL_LIVE_HOST })).toThrow(/LIVE/);
    expect(() => parseEnv({ ...base, PAYPAL_BASE_URL: PAYPAL_LIVE_HOST, AEGIS_ALLOW_LIVE: "true" })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...base, PAYPAL_BASE_URL: PAYPAL_LIVE_HOST, AEGIS_ENVIRONMENT: "production" })).toThrow(EnvValidationError);
    expect(parseEnv({ ...base, PAYPAL_BASE_URL: PAYPAL_LIVE_HOST, AEGIS_ALLOW_LIVE: "true", AEGIS_ENVIRONMENT: "production" }).paypal.live).toBe(true);
  });
  it("requires a real session secret in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });
  it("warns loudly when browser and server client ids differ", () => {
    const env = parseEnv({ ...base, PAYPAL_CLIENT_ID: "A", PAYPAL_CLIENT_SECRET: "B", NEXT_PUBLIC_PAYPAL_CLIENT_ID: "C" });
    expect(env.warnings.some((w) => w.includes("same PayPal app"))).toBe(true);
  });
  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
  });
});

describe("demo session signing and CSRF", () => {
  it("verifies signed sessions and rejects tampering", async () => {
    const sid = "123e4567-e89b-12d3-a456-426614174000";
    const signed = await signSession(sid);
    expect(await verifySession(signed)).toBe(sid);
    expect(await verifySession(signed.replace(sid, "123e4567-e89b-12d3-a456-426614174001"))).toBeNull();
    expect(await verifySession(`${sid}.forged`)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
  it("binds CSRF tokens to the session", async () => {
    const a = "123e4567-e89b-12d3-a456-426614174000";
    const b = "123e4567-e89b-12d3-a456-426614174999";
    expect(await verifyCsrf(a, await csrfTokenFor(a))).toBe(true);
    expect(await verifyCsrf(a, await csrfTokenFor(b))).toBe(false);
    expect(await verifyCsrf(a, null)).toBe(false);
  });
});

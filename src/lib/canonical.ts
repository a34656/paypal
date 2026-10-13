import { createHash } from "node:crypto";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped, no whitespace.
 * Non-finite numbers, bigints, functions and Dates are rejected so a hash can never
 * silently depend on lossy serialisation.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      if (value instanceof Date) throw new TypeError("canonicalize: convert Dates to ISO strings first");
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

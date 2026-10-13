/**
 * Demo-session signing with Web Crypto (works in the proxy and in route handlers).
 * This is DEMO identity, not authentication: it isolates visitors and attributes actions,
 * but anyone with the cookie is that visitor.
 */
export const SESSION_COOKIE = "aegis_sid";
export const CSRF_COOKIE = "aegis_csrf";
export const CSRF_HEADER = "x-aegis-csrf";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789abcdef";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : DEV_SESSION_SECRET;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SID_PATTERN = /^[0-9a-f-]{36}$/;

export async function signSession(sid: string): Promise<string> {
  return `${sid}.${await hmac(`sid:${sid}`)}`;
}

/** Returns the session id if the cookie value carries a valid signature, else null. */
export async function verifySession(cookieValue: string | undefined | null): Promise<string | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return null;
  const sid = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!SID_PATTERN.test(sid)) return null;
  return timingSafeEqual(sig, await hmac(`sid:${sid}`)) ? sid : null;
}

/** CSRF token bound to the session (double-submit cookie + header). */
export async function csrfTokenFor(sid: string): Promise<string> {
  return hmac(`csrf:${sid}`);
}

export async function verifyCsrf(sid: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  return timingSafeEqual(token, await csrfTokenFor(sid));
}

"use client";
/**
 * Browser API client. Sends the CSRF token (double-submit cookie) on state-changing calls.
 * The UI never treats a request as successful unless the server says ok: true.
 */
import useSWR, { type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
    public readonly correlationId: string | null,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)aegis_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "content-type": "application/json", "x-aegis-csrf": csrfToken() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let json: { ok?: boolean; data?: T; error?: { code: string; message: string; details?: unknown }; correlationId?: string } = {};
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "INTERNAL", `Unexpected response (HTTP ${res.status})`, null, null);
  }
  if (!res.ok || !json.ok) {
    throw new ApiError(res.status, json.error?.code ?? "INTERNAL", json.error?.message ?? `Request failed (HTTP ${res.status})`, json.error?.details ?? null, json.correlationId ?? null);
  }
  return json.data as T;
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, (p: string) => apiFetch<T>(p), { revalidateOnFocus: false, ...config });
}

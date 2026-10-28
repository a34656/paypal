import { NextResponse } from "next/server";

/**
 * Lightweight health-check endpoint.
 * Used by Render's health-check probe and keep-alive pings.
 * Does NOT hit the database – returns instantly so cold-start
 * detection isn't skewed by DB latency.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

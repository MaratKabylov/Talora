import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { drainScoringJobs } from "@/lib/scoring/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({ limit: z.number().int().min(1).max(10).optional() });

function validBearer(request: NextRequest) {
  const expected = process.env.SCORING_WORKER_SECRET;
  const provided = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!expected || expected.length < 32 || !provided) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (process.env.ASSESSMENT_ASYNC_SCORING_V2 !== "true") {
    return NextResponse.json({ error: "Async scoring is disabled." }, { status: 409, headers });
  }
  if (!validBearer(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await drainScoringJobs({ limit: parsed.data.limit }), { headers });
  } catch {
    return NextResponse.json({ error: "Unable to drain scoring jobs." }, { status: 500, headers });
  }
}

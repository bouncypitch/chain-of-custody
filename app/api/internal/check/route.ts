import { NextRequest, NextResponse } from "next/server";
import { canView } from "@/lib/policy";
import type { FactKey } from "@/lib/types";

/**
 * The policy engine, reachable as its own HTTP boundary rather than only an
 * in-process function call. Today this still runs in the same deployable as
 * everything else — the honest hackathon-scoped version of "the gate is a
 * separate service" — but the replay verifier calls it over the network
 * (see lib/verifier.ts's http-boundary mode) rather than importing it
 * directly, so the audit step doesn't have to trust the same process that ran
 * the scenario. This is the seam a real deployment would split at.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { viewerId, targetId, factKey } = body;
  if (!viewerId || !targetId || !factKey) {
    return NextResponse.json({ error: "viewerId, targetId, factKey are required" }, { status: 400 });
  }
  const decision = canView(viewerId, targetId, factKey as FactKey);
  return NextResponse.json(decision);
}

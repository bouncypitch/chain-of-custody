import { NextRequest, NextResponse } from "next/server";
import { runScenario } from "@/lib/agent";
import { getTrace } from "@/lib/trace";
import { verifyToken } from "@/lib/authTokens";
import type { ScenarioId } from "@/lib/types";

const VALID: ScenarioId[] = ["happy-path", "input-denial", "output-leak", "hallucination"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const scenario = body.scenario as ScenarioId;
  if (!VALID.includes(scenario)) {
    return NextResponse.json({ error: `scenario must be one of ${VALID.join(", ")}` }, { status: 400 });
  }

  const authHeader = req.headers.get("authorization");
  const token = body.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const auth = verifyToken(token);
  if (!auth.valid) {
    return NextResponse.json({ error: `unauthenticated: ${auth.reason}` }, { status: 401 });
  }

  const result = runScenario(scenario, Boolean(body.preemptive));
  const trace = getTrace(result.sessionId);
  return NextResponse.json({ ...result, trace, authenticatedAs: auth.subjectId });
}

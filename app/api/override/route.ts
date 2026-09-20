import { NextRequest, NextResponse } from "next/server";
import { requestOverride } from "@/lib/override";
import { verifyToken } from "@/lib/authTokens";
import { getTrace } from "@/lib/trace";
import type { FactKey } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, targetId, factKey, token } = body;
  if (!sessionId || !targetId || !factKey) {
    return NextResponse.json({ error: "sessionId, targetId, factKey are required" }, { status: 400 });
  }

  const auth = verifyToken(token);
  if (!auth.valid) {
    return NextResponse.json({ error: `unauthenticated approver: ${auth.reason}` }, { status: 401 });
  }

  const result = requestOverride(sessionId, auth.subjectId!, targetId, factKey as FactKey);
  const trace = getTrace(sessionId);
  return NextResponse.json({ ...result, trace });
}

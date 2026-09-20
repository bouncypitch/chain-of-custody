import { NextRequest, NextResponse } from "next/server";
import { recordApproval } from "@/lib/agent";
import { getTrace } from "@/lib/trace";
import { verifyToken } from "@/lib/authTokens";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, decision, note, token } = body;
  if (!sessionId || (decision !== "approved" && decision !== "rejected")) {
    return NextResponse.json({ error: "sessionId and decision ('approved'|'rejected') are required" }, { status: 400 });
  }

  const auth = verifyToken(token);
  if (!auth.valid) {
    return NextResponse.json({ error: `unauthenticated approver: ${auth.reason}` }, { status: 401 });
  }

  const event = recordApproval(sessionId, auth.subjectId!, decision, note);
  const trace = getTrace(sessionId);
  return NextResponse.json({ event, trace, approverId: auth.subjectId });
}

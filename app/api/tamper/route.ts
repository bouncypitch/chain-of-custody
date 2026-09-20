import { NextRequest, NextResponse } from "next/server";
import { tamperTrace } from "@/lib/trace";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  const result = tamperTrace(sessionId);
  return NextResponse.json(result);
}

import { NextRequest, NextResponse } from "next/server";
import { replayVerify } from "@/lib/verifier";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, useHttpBoundary } = body;
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  const baseUrl = req.nextUrl.origin;
  const report = await replayVerify(sessionId, Boolean(useHttpBoundary), baseUrl);
  return NextResponse.json(report);
}

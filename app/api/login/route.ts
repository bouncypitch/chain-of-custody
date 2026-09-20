import { NextRequest, NextResponse } from "next/server";
import { issueToken } from "@/lib/authTokens";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { subjectId } = body;
  if (!subjectId) return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
  const issued = issueToken(subjectId);
  if (!issued) return NextResponse.json({ error: `'${subjectId}' is not a known identity` }, { status: 400 });
  return NextResponse.json(issued);
}

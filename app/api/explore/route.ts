import { NextRequest, NextResponse } from "next/server";
import { canView } from "@/lib/policy";
import { getOrg } from "@/lib/data";
import type { FactKey } from "@/lib/types";

const FACTS: FactKey[] = ["rating", "managerNote", "compBand", "stackRank"];

export async function GET() {
  return NextResponse.json({ org: getOrg(), facts: FACTS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { viewerId, targetId, factKey } = body;
  if (!viewerId || !targetId || !factKey) {
    return NextResponse.json({ error: "viewerId, targetId, factKey are required" }, { status: 400 });
  }
  const decision = canView(viewerId, targetId, factKey as FactKey);
  return NextResponse.json(decision);
}

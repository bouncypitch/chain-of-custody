import { NextResponse } from "next/server";
import { runFairnessReport, computeBands, nameSwapTest } from "@/lib/consistency";

export async function GET() {
  const precedent = runFairnessReport();
  const bands = computeBands();
  const nameSwap = nameSwapTest("dana");
  return NextResponse.json({ precedent, bands, nameSwap });
}

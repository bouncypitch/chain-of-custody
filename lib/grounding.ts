/**
 * A "closed-world" check: every substantive line in a draft must be traceable
 * to something the gate actually released (a fact in factsUsed) or to known
 * boilerplate (greeting, sign-off). Anything else is unverified and blocked by
 * default — fail-closed, not fail-open. This matters because the output gate
 * elsewhere only re-checks facts it KNOWS were fetched through the gateway;
 * it has no way to catch a fabricated claim that never went through a gated
 * fetch at all. A deterministic, template-based drafting step (what this demo
 * actually uses) can't hallucinate, so this check is trivially satisfied today
 * — it exists to prove the harness is ready for the day a real LLM drafts
 * instead of a template, which is exactly where an ungrounded claim could slip
 * past a gate that only checks known facts.
 */
export interface GroundingResult {
  ungroundedLines: string[];
  finalText: string;
}

export function checkGrounding(draftText: string, allowedLines: string[]): GroundingResult {
  const allowedSet = new Set(allowedLines.map((l) => l.trim()));
  const lines = draftText.split("\n");
  const ungroundedLines: string[] = [];

  const finalLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || allowedSet.has(trimmed)) return line;
    ungroundedLines.push(trimmed);
    return `[BLOCKED — ungrounded claim, not traceable to any gated fetch: "${trimmed}"]`;
  });

  return { ungroundedLines, finalText: finalLines.join("\n") };
}

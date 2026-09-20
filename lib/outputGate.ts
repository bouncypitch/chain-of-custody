import { canView } from "./policy";
import { appendEvent } from "./trace";
import type { FactKey } from "./types";

export interface FactUsage {
  targetId: string;
  factKey: FactKey;
  value: string;
}

export interface OutputGateResult {
  finalText: string;
  blocked: { targetId: string; factKey: FactKey; reason: string }[];
}

/**
 * Runs BEFORE a drafted reply is delivered. Checks every fact the agent wove
 * into the draft against the *recipient's* clearance for that fact about that
 * subject — not the caller who originally fetched it. A caller can be fully
 * entitled to a fact and still have it blocked here if the recipient isn't.
 */
export function checkDelivery(
  sessionId: string,
  recipientId: string,
  draftText: string,
  factsUsed: FactUsage[]
): OutputGateResult {
  let finalText = draftText;
  const blocked: OutputGateResult["blocked"] = [];

  for (const usage of factsUsed) {
    const decision = canView(recipientId, usage.targetId, usage.factKey);
    if (decision.allowed) {
      appendEvent(sessionId, {
        type: "output_gate_check",
        actorId: recipientId,
        targetId: usage.targetId,
        factKey: usage.factKey,
        decision: "allowed",
        reason: decision.reason,
        value: usage.value,
      });
    } else {
      blocked.push({ targetId: usage.targetId, factKey: usage.factKey, reason: decision.reason });
      finalText = finalText.split(usage.value).join(`[REDACTED — recipient clearance insufficient: ${decision.reason}]`);
      appendEvent(sessionId, {
        type: "output_gate_check",
        actorId: recipientId,
        targetId: usage.targetId,
        factKey: usage.factKey,
        decision: "denied",
        reason: decision.reason,
      });
    }
  }

  return { finalText, blocked };
}

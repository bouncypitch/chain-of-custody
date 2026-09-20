import { canView } from "./policy";
import { getFactValue } from "./data";
import { appendEvent, getTrace } from "./trace";
import type { FactKey } from "./types";

export interface GatewayResult {
  targetId: string;
  granted: Partial<Record<FactKey, string>>;
  denied: Partial<Record<FactKey, string>>; // factKey -> reason
}

const ALL_FACTS: FactKey[] = ["rating", "managerNote", "compBand", "stackRank", "businessEvents"];

/** A single denied fetch is normal. This many in one session from the same
 * caller is a pattern worth a human's attention — flagged once, the first
 * time the count crosses the line, not re-flagged on every event after. */
const ANOMALY_THRESHOLD = 3;

function checkDenialAnomaly(sessionId: string, callerId: string) {
  const trace = getTrace(sessionId);
  const denialsSoFar = trace.filter((e) => e.type === "gateway_fetch" && e.actorId === callerId && e.decision === "denied").length;
  const alreadyFlagged = trace.some((e) => e.type === "anomaly_flag" && e.actorId === callerId);
  if (denialsSoFar === ANOMALY_THRESHOLD && !alreadyFlagged) {
    appendEvent(sessionId, {
      type: "anomaly_flag",
      actorId: callerId,
      decision: "denied",
      reason: `${denialsSoFar} denied fetch attempts by ${callerId} in this session — possible compromised or adversarially-probed agent, flagged for review`,
    });
  }
}

/**
 * The ONLY path to review data. The agent's tool schema knows this function and
 * nothing else — it has no direct handle on the data store. Every field is
 * checked individually against the caller's relationship to the subject before
 * being released; denied fields are never even written into the trace's value.
 *
 * When the eventual reader is already known (intendedRecipientId), each fact is
 * ALSO checked against that recipient's clearance before it's released — so a
 * fact that would only fail at the output gate never enters the draft's context
 * at all. This does not replace the output gate: it's only safe to short-circuit
 * here when the recipient is fixed before the fetch happens. Whenever the agent
 * fetches once and the recipient isn't yet known, or the same context gets
 * reused for a later, different-audience output, the output gate is still the
 * only thing standing between a legitimately-fetched fact and the wrong reader.
 */
export function getReviewData(
  callerId: string,
  targetId: string,
  sessionId: string,
  intendedRecipientId?: string
): GatewayResult {
  const result: GatewayResult = { targetId, granted: {}, denied: {} };

  for (const factKey of ALL_FACTS) {
    const callerDecision = canView(callerId, targetId, factKey);

    if (!callerDecision.allowed) {
      result.denied[factKey] = callerDecision.reason;
      appendEvent(sessionId, {
        type: "gateway_fetch",
        actorId: callerId,
        targetId,
        factKey,
        decision: "denied",
        reason: callerDecision.reason,
      });
      checkDenialAnomaly(sessionId, callerId);
      continue;
    }

    if (intendedRecipientId) {
      const recipientDecision = canView(intendedRecipientId, targetId, factKey);
      if (!recipientDecision.allowed) {
        const reason = `caller is cleared, but the intended recipient is not (${recipientDecision.reason}) — withheld at fetch time instead of drafted and redacted`;
        result.denied[factKey] = reason;
        appendEvent(sessionId, {
          type: "gateway_fetch",
          actorId: callerId,
          targetId,
          factKey,
          decision: "denied",
          reason,
        });
        checkDenialAnomaly(sessionId, callerId);
        continue;
      }
    }

    const value = getFactValue(targetId, factKey);
    result.granted[factKey] = value;
    appendEvent(sessionId, {
      type: "gateway_fetch",
      actorId: callerId,
      targetId,
      factKey,
      decision: "allowed",
      reason: callerDecision.reason,
      value,
    });
  }

  return result;
}

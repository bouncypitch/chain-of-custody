import { getTrace, appendEvent } from "./trace";
import { getFactValue } from "./data";
import type { FactKey } from "./types";

/**
 * Reveals a fact the output gate blocked, but only after two DISTINCT
 * authenticated approvers have each signed off on this exact (target, fact)
 * pair for this session — dual control, not a single button anyone can click.
 * Every approval is tied to a verified token identity (see authTokens.ts /
 * approve route), not a self-reported string.
 */
export interface OverrideResult {
  granted: boolean;
  approverCount: number;
  approvers: string[];
  value?: string;
  message: string;
}

export function requestOverride(sessionId: string, approverId: string, targetId: string, factKey: FactKey): OverrideResult {
  const trace = getTrace(sessionId);

  const priorApprovers = new Set(
    trace
      .filter((e) => e.type === "override_approval" && e.targetId === targetId && e.factKey === factKey)
      .map((e) => e.actorId)
  );

  if (priorApprovers.has(approverId)) {
    return {
      granted: false,
      approverCount: priorApprovers.size,
      approvers: [...priorApprovers],
      message: `${approverId} already signed off on this override — need a second, different approver.`,
    };
  }

  appendEvent(sessionId, {
    type: "override_approval",
    actorId: approverId,
    targetId,
    factKey,
    decision: "allowed",
    reason: `override sign-off ${priorApprovers.size + 1} of 2`,
  });

  const allApprovers = [...priorApprovers, approverId];

  if (allApprovers.length < 2) {
    return {
      granted: false,
      approverCount: allApprovers.length,
      approvers: allApprovers,
      message: `1 of 2 required approvals recorded. Need one more, different approver.`,
    };
  }

  const value = getFactValue(targetId, factKey);
  appendEvent(sessionId, {
    type: "override_granted",
    actorId: allApprovers.join(" + "),
    targetId,
    factKey,
    decision: "allowed",
    reason: `dual-control override granted after sign-off from ${allApprovers.join(" and ")}`,
    value,
  });

  return {
    granted: true,
    approverCount: allApprovers.length,
    approvers: allApprovers,
    value,
    message: `Override granted after sign-off from ${allApprovers.join(" and ")}.`,
  };
}

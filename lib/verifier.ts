import { getTrace, verifyChain, ChainVerifyReport } from "./trace";
import { canView } from "./policy";
import { getFactValue } from "./data";
import type { FactKey, ViewDecision } from "./types";

export interface VerifierStepResult {
  seq: number;
  type: string;
  actorId: string;
  targetId?: string;
  factKey?: FactKey;
  recordedDecision?: string;
  recomputedDecision?: string;
  match: boolean;
  detail: string;
}

export interface VerifierReport {
  sessionId: string;
  totalSteps: number;
  matched: number;
  mismatched: number;
  ok: boolean;
  steps: VerifierStepResult[];
  chain: ChainVerifyReport;
  checkedVia: "in-process" | "http-boundary";
}

type PolicyChecker = (viewerId: string, targetId: string, factKey: FactKey) => Promise<ViewDecision>;

const inProcessChecker: PolicyChecker = async (viewerId, targetId, factKey) => canView(viewerId, targetId, factKey);

/** Calls the internal policy-check endpoint over HTTP instead of importing canView directly —
 * so the verifier doesn't even have to trust its own process. Used only for verification/audit,
 * never on the live scenario-running path, so it can't destabilize the demo if the loopback call
 * is slow or the port differs from the default. */
function makeHttpChecker(baseUrl: string): PolicyChecker {
  return async (viewerId, targetId, factKey) => {
    const res = await fetch(`${baseUrl}/api/internal/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId, targetId, factKey }),
    });
    if (!res.ok) throw new Error(`internal policy endpoint returned ${res.status}`);
    return res.json();
  };
}

const RECORDED_AS_IS_TYPES = new Set(["session_start", "approval", "anomaly_flag", "override_approval", "override_granted", "grounding_check"]);

/**
 * Independently re-derives what each gateway/output-gate decision SHOULD have
 * been, straight from the current policy + data, and diffs it against what the
 * trace recorded. This is stronger than checking a signature: a signed log only
 * proves nobody edited the file after the fact. This proves the recorded
 * decision actually matches what the policy says should have happened.
 *
 * Also independently verifies the trace's hash chain (see trace.ts) — a second,
 * unrelated tamper signal that doesn't depend on policy at all.
 */
export async function replayVerify(sessionId: string, useHttpBoundary = false, baseUrl = ""): Promise<VerifierReport> {
  const trace = getTrace(sessionId);
  const steps: VerifierStepResult[] = [];
  const checker = useHttpBoundary ? makeHttpChecker(baseUrl) : inProcessChecker;

  for (const event of trace) {
    if (RECORDED_AS_IS_TYPES.has(event.type)) {
      steps.push({
        seq: event.seq,
        type: event.type,
        actorId: event.actorId,
        recordedDecision: event.decision,
        match: true,
        detail: event.reason ?? event.note ?? "recorded procedural event (not an independently re-derivable policy decision)",
      });
      continue;
    }

    if (!event.targetId || !event.factKey) {
      steps.push({
        seq: event.seq,
        type: event.type,
        actorId: event.actorId,
        match: false,
        detail: "malformed event — missing targetId/factKey",
      });
      continue;
    }

    const recomputed = await checker(event.actorId, event.targetId, event.factKey);
    const recomputedDecision = recomputed.allowed ? "allowed" : "denied";
    let match = recomputedDecision === event.decision;
    let detail = `recomputed policy check: ${recomputedDecision} (${recomputed.reason})`;

    if (match && recomputedDecision === "allowed") {
      const currentValue = getFactValue(event.targetId, event.factKey);
      if (event.value !== currentValue) {
        match = false;
        detail = `decision matched, but recorded value does not match current data snapshot (recorded: "${event.value}", current: "${currentValue}")`;
      }
    }

    steps.push({
      seq: event.seq,
      type: event.type,
      actorId: event.actorId,
      targetId: event.targetId,
      factKey: event.factKey,
      recordedDecision: event.decision,
      recomputedDecision,
      match,
      detail,
    });
  }

  const matched = steps.filter((s) => s.match).length;
  const chain = verifyChain(sessionId);
  return {
    sessionId,
    totalSteps: steps.length,
    matched,
    mismatched: steps.length - matched,
    ok: matched === steps.length && chain.ok,
    steps,
    chain,
    checkedVia: useHttpBoundary ? "http-boundary" : "in-process",
  };
}

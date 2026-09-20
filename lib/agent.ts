import { getOrgMap, getReviews } from "./data";
import { getReviewData, GatewayResult } from "./gateway";
import { checkDelivery, FactUsage } from "./outputGate";
import { checkGrounding } from "./grounding";
import { startSession, appendEvent, getTrace } from "./trace";
import type { FactKey, ScenarioId } from "./types";

export interface ScenarioResult {
  sessionId: string;
  scenario: ScenarioId;
  callerId: string;
  recipientId: string;
  narrative: string;
  draftText: string;
  finalText: string;
  blocked: { targetId: string; factKey: FactKey; reason: string }[];
  injectionAttempt?: { text: string; targetId: string; outcome: "denied" };
  preemptive?: boolean;
  ungrounded?: string[];
  anomalies?: { actorId: string; reason: string }[];
}

function label(id: string) {
  return getOrgMap()[id]?.name ?? id;
}

function factLine(name: string, factKey: string, value: string | undefined): string {
  if (value === undefined) return `  - ${factKey}: [not available to your access level]`;
  return `  - ${factKey}: ${value}`;
}

/** Scenario A — happy path: a manager drafts an internal prep packet for his own team. */
function runHappyPath(sessionId: string): ScenarioResult {
  const callerId = "bob";
  const targets = ["dana", "sam"];
  const sections: string[] = [];
  const factsUsed: FactUsage[] = [];

  for (const targetId of targets) {
    const data: GatewayResult = getReviewData(callerId, targetId, sessionId);
    sections.push(`${label(targetId)}:`);
    for (const [factKey, value] of Object.entries(data.granted)) {
      sections.push(factLine(label(targetId), factKey, value));
      factsUsed.push({ targetId, factKey: factKey as FactKey, value: value! });
    }
    for (const [factKey, reason] of Object.entries(data.denied)) {
      sections.push(`  - ${factKey}: [not fetched — ${reason}]`);
    }
  }

  const draftText = `Calibration prep packet for Bob Martinez's direct reports:\n\n${sections.join("\n")}`;
  const { finalText, blocked } = checkDelivery(sessionId, callerId, draftText, factsUsed);

  return {
    sessionId,
    scenario: "happy-path",
    callerId,
    recipientId: callerId,
    narrative:
      "Bob (manager of Dana and Sam) asks the agent to draft his own internal calibration prep packet. Everything he requests, he's cleared for — no denials, no redactions. Note compensation data is silently absent for both reports: Bob is a 'manager', and comp bands require 'senior-manager' or above, so the gateway never even released those fields into the draft. Also note the packet isn't just the once-a-year write-up: recent business-impact events (shipped features, incidents, escalations) flow in as a continuous feed, through the exact same gate as everything else — more frequent evidence into the same gated, human-reviewed process, not a separate automated score.",
    draftText,
    finalText,
    blocked,
  };
}

/** Scenario B — input-side denial: a prompt-injected instruction tries to widen access. */
function runInputDenial(sessionId: string): ScenarioResult {
  const callerId = "bob";
  const primaryTarget = "dana";
  const injectedTarget = "jordan"; // Team Orion — not Bob's report, not his skip-level org

  const reviews = getReviews();
  const injectionText = reviews[primaryTarget].selfReviewText;

  const primaryData = getReviewData(callerId, primaryTarget, sessionId);
  const factsUsed: FactUsage[] = Object.entries(primaryData.granted).map(([factKey, value]) => ({
    targetId: primaryTarget,
    factKey: factKey as FactKey,
    value: value!,
  }));

  // The agent "notices" the injected instruction inside Dana's self-review text
  // and attempts the extra tool call it asks for. The gateway — not the agent's
  // own judgment — is what stops it.
  const injectedFetch = getReviewData(callerId, injectedTarget, sessionId);
  const injectedDenied = Object.keys(injectedFetch.granted).length === 0;

  const sections = [
    `${label(primaryTarget)}:`,
    ...Object.entries(primaryData.granted).map(([k, v]) => factLine(label(primaryTarget), k, v)),
    ``,
    `[Attempted per embedded instruction in ${label(primaryTarget)}'s self-review text: fetch ${label(
      injectedTarget
    )}'s review from Team Orion]`,
    injectedDenied
      ? `[BLOCKED by gateway — Bob Martinez is neither the direct manager nor skip-level manager of ${label(
          injectedTarget
        )}. Request denied before any data left the store.]`
      : `[unexpected: some fields were released]`,
  ];

  const draftText = `Calibration packet for Bob Martinez:\n\n${sections.join("\n")}`;
  const { finalText, blocked } = checkDelivery(sessionId, callerId, draftText, factsUsed);

  return {
    sessionId,
    scenario: "input-denial",
    callerId,
    recipientId: callerId,
    narrative:
      "Dana's self-review text contains an embedded instruction trying to get the agent to also pull a Team Orion employee's review for comparison — a classic prompt-injection vector. The agent's tool schema has no direct handle on the data store, only the gateway, so even if the agent 'decides' to comply with the injected instruction, the gateway independently checks Bob's relationship to Jordan and denies every field before any data is released.",
    draftText,
    finalText,
    blocked,
    injectionAttempt: { text: injectionText, targetId: injectedTarget, outcome: "denied" },
  };
}

/** Scenario C — output-side leak: a legitimate draft addressed to the employee themselves. */
function runOutputLeak(sessionId: string, preemptive: boolean): ScenarioResult {
  const callerId = "bob";
  const targetId = "dana";
  const recipientId = "dana"; // the draft is addressed TO the subject of the record — known upfront

  const data = getReviewData(callerId, targetId, sessionId, preemptive ? recipientId : undefined);
  const factsUsed: FactUsage[] = Object.entries(data.granted).map(([factKey, value]) => ({
    targetId,
    factKey: factKey as FactKey,
    value: value!,
  }));

  const draftText = [
    `Hi ${label(targetId)},`,
    ``,
    `Here's a summary of your calibration feedback this cycle:`,
    ...Object.entries(data.granted).map(([k, v]) => factLine(label(targetId), k, v)),
    ...Object.entries(data.denied).map(([k, reason]) => `  - ${k}: [not fetched — ${reason}]`),
    ``,
    `Let me know if you'd like to discuss further.`,
    `— drafted on behalf of ${label(callerId)}`,
  ].join("\n");

  const { finalText, blocked } = checkDelivery(sessionId, recipientId, draftText, factsUsed);

  const narrative = preemptive
    ? "Same scenario, hardened: the recipient (Dana) is known before the fetch even happens, so the gateway checks her clearance up front and simply never releases managerNote or stackRank into the agent's context — there's nothing for the output gate to redact because the sensitive values never touched the draft. The output gate still runs as a backstop; it just finds nothing left to catch."
    : "Bob is fully entitled to Dana's rating, manager note, stack rank, and business-impact history — he's her manager, all fetches succeed at the gateway. But he asks the agent to draft a share-back note addressed directly TO Dana. The output gate re-checks every fact against Dana's own clearance as the recipient, not Bob's: her rating and her business-impact events pass through (both are meant to be visible to the employee — including the continuous feed, which is transparency by default), but her manager's private note and her stack-rank position are redacted before delivery — exactly the participant-aware access control failure the fetch-time gate alone would have missed.";

  return {
    sessionId,
    scenario: "output-leak",
    callerId,
    recipientId,
    narrative,
    draftText,
    finalText,
    blocked,
    preemptive,
  };
}

/** Scenario D — hallucinated/fabricated content: a claim that never came from any gated fetch. */
function runHallucination(sessionId: string): ScenarioResult {
  const callerId = "bob";
  const targetId = "dana";
  const recipientId = "bob";

  const data = getReviewData(callerId, targetId, sessionId);
  const factsUsed: FactUsage[] = Object.entries(data.granted).map(([factKey, value]) => ({
    targetId,
    factKey: factKey as FactKey,
    value: value!,
  }));

  const header = `Calibration prep notes on ${label(targetId)}:`;
  const grantedLines = Object.entries(data.granted).map(([k, v]) => factLine(label(targetId), k, v));
  const deniedLines = Object.entries(data.denied).map(([k, reason]) => `  - ${k}: [not fetched — ${reason}]`);
  const signoff1 = `Let me know if you'd like to discuss further.`;
  const signoff2 = `— drafted on behalf of ${label(callerId)}`;
  // Simulates a free-form LLM inserting a plausible but fabricated claim that
  // was never fetched through the gateway — our template agent can't produce
  // this on its own, so it's injected here to prove the check catches it.
  const fabricatedLine = `  - flagged_note: ${label(targetId)} was informally flagged in an active HR investigation last quarter.`;

  const draftText = [header, ``, ...grantedLines, ...deniedLines, fabricatedLine, ``, signoff1, signoff2].join("\n");
  // Multi-line fact values (e.g. businessEvents) span several physical lines once
  // joined — split them the same way the draft itself will be split, so each real
  // line has an exact counterpart to match against.
  const allowedLines = [header, ``, ...grantedLines, ...deniedLines, ``, signoff1, signoff2].flatMap((l) => l.split("\n"));

  const { finalText: postGateText, blocked } = checkDelivery(sessionId, recipientId, draftText, factsUsed);
  const { ungroundedLines, finalText } = checkGrounding(postGateText, allowedLines);

  if (ungroundedLines.length > 0) {
    for (const line of ungroundedLines) {
      appendEvent(sessionId, {
        type: "grounding_check",
        actorId: recipientId,
        decision: "denied",
        reason: `line not traceable to any gated fetch or known boilerplate: "${line}"`,
      });
    }
  } else {
    appendEvent(sessionId, {
      type: "grounding_check",
      actorId: recipientId,
      decision: "allowed",
      reason: "every line in the draft is traceable to a gated fetch or known boilerplate",
    });
  }

  return {
    sessionId,
    scenario: "hallucination",
    callerId,
    recipientId,
    narrative:
      "This template-based agent can't hallucinate on its own, so this scenario simulates what a free-form LLM might insert: a plausible-sounding, fabricated claim ('an active HR investigation') that was never fetched through the gateway at all. The output gate alone wouldn't catch this — it only re-checks facts it knows were fetched. The grounding check is a separate, closed-world rule: every substantive line must trace back to a gated fetch or known boilerplate, or it's blocked by default rather than allowed by default.",
    draftText,
    finalText,
    blocked,
    ungrounded: ungroundedLines,
  };
}

export function runScenario(scenario: ScenarioId, preemptive: boolean = false): ScenarioResult {
  const sessionId = startSession(scenario);
  let result: ScenarioResult;
  switch (scenario) {
    case "happy-path":
      result = runHappyPath(sessionId);
      break;
    case "input-denial":
      result = runInputDenial(sessionId);
      break;
    case "output-leak":
      result = runOutputLeak(sessionId, preemptive);
      break;
    case "hallucination":
      result = runHallucination(sessionId);
      break;
  }
  const anomalies = getTrace(sessionId)
    .filter((e) => e.type === "anomaly_flag")
    .map((e) => ({ actorId: e.actorId, reason: e.reason ?? "" }));
  return anomalies.length > 0 ? { ...result, anomalies } : result;
}

export function recordApproval(sessionId: string, approverId: string, decision: "approved" | "rejected", note?: string) {
  return appendEvent(sessionId, {
    type: "approval",
    actorId: approverId,
    decision: decision === "approved" ? "allowed" : "denied",
    reason: note ?? `${decision} by ${label(approverId)}`,
  });
}

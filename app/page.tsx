"use client";

import { useState, useEffect } from "react";

type ScenarioId = "happy-path" | "input-denial" | "output-leak" | "hallucination";

interface TraceEvent {
  seq: number;
  timestamp: string;
  type: string;
  actorId: string;
  targetId?: string;
  factKey?: string;
  decision?: "allowed" | "denied";
  reason?: string;
  value?: string;
  note?: string;
  prevHash?: string;
  hash?: string;
}

interface ScenarioResult {
  sessionId: string;
  scenario: ScenarioId;
  callerId: string;
  recipientId: string;
  narrative: string;
  draftText: string;
  finalText: string;
  blocked: { targetId: string; factKey: string; reason: string }[];
  injectionAttempt?: { text: string; targetId: string; outcome: string };
  preemptive?: boolean;
  ungrounded?: string[];
  anomalies?: { actorId: string; reason: string }[];
  authenticatedAs?: string;
  trace: TraceEvent[];
}

interface VerifierStep {
  seq: number;
  type: string;
  actorId: string;
  targetId?: string;
  factKey?: string;
  recordedDecision?: string;
  recomputedDecision?: string;
  match: boolean;
  detail: string;
}

interface ChainStep {
  seq: number;
  linkageOk: boolean;
  contentOk: boolean;
}

interface VerifierReport {
  sessionId: string;
  totalSteps: number;
  matched: number;
  mismatched: number;
  ok: boolean;
  steps: VerifierStep[];
  chain: { ok: boolean; steps: ChainStep[] };
  checkedVia: "in-process" | "http-boundary";
}

interface PrecedentResult {
  employeeId: string;
  employeeName: string;
  rating: string;
  text: string;
  score: number;
  positiveHits: string[];
  negativeHits: string[];
  band: { min: number; max: number; sampleSize: number } | null;
  withinBand: boolean;
  note: string;
}

interface Band {
  min: number;
  max: number;
  sampleSize: number;
  examples: { cycle: string; team: string; text: string; score: number }[];
}

interface NameSwapResult {
  employeeId: string;
  variants: { name: string; draftText: string; score: number }[];
  allIdentical: boolean;
}

interface ConsistencyReport {
  precedent: PrecedentResult[];
  bands: Record<string, Band>;
  nameSwap: NameSwapResult;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  managerId: string | null;
  team: string;
}

interface Session {
  subjectId: string;
  token: string;
  expiresAt: number;
}

interface OverrideState {
  approvers: string[];
  granted: boolean;
  value?: string;
  message: string;
}

const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "happy-path", label: "1. Happy path", hint: "Manager drafts his own team's packet" },
  { id: "input-denial", label: "2. Input-side denial", hint: "Injected instruction tries to widen access" },
  { id: "output-leak", label: "3. Output-side leak", hint: "Legitimate draft addressed to the employee" },
  { id: "hallucination", label: "4. Ungrounded claim", hint: "Fabricated content not from any gated fetch" },
];

function overrideKey(targetId: string, factKey: string) {
  return `${targetId}:${factKey}`;
}

export default function Home() {
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [approval, setApproval] = useState<"approved" | "rejected" | null>(null);
  const [verifyReport, setVerifyReport] = useState<VerifierReport | null>(null);
  const [tampered, setTampered] = useState(false);
  const [consistency, setConsistency] = useState<ConsistencyReport | null>(null);
  const [preemptive, setPreemptive] = useState(false);
  const [useHttpBoundary, setUseHttpBoundary] = useState(false);

  const [org, setOrg] = useState<Employee[]>([]);
  const [selectedPersona, setSelectedPersona] = useState("bob");
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});

  useEffect(() => {
    fetch("/api/consistency").then((r) => r.json()).then(setConsistency).catch(() => {});
    fetch("/api/explore").then((r) => r.json()).then((d) => setOrg(d.org)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function login() {
    setAuthError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: selectedPersona }),
    });
    if (!res.ok) {
      setAuthError((await res.json()).error);
      return;
    }
    const { token, expiresAt } = await res.json();
    setSession({ subjectId: selectedPersona, token, expiresAt });
  }

  async function forgeAndTest() {
    if (!session) return;
    const forged = session.token.slice(0, -1) + (session.token.slice(-1) === "a" ? "b" : "a");
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "happy-path", token: forged }),
    });
    const body = await res.json();
    setAuthError(res.ok ? "unexpected: forged token was accepted" : `Rejected as expected: ${body.error}`);
  }

  async function runScenario(scenario: ScenarioId) {
    if (!session) return;
    setLoading(true);
    setApproval(null);
    setVerifyReport(null);
    setTampered(false);
    setOverrides({});
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario, preemptive: scenario === "output-leak" ? preemptive : false, token: session.token }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(`Run failed: ${data.error} — log in again.`);
      setSession(null);
      setLoading(false);
      return;
    }
    setResult(data);
    setLoading(false);
  }

  async function approve(decision: "approved" | "rejected") {
    if (!result || !session) return;
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: result.sessionId, decision, token: session.token }),
    });
    setApproval(decision);
  }

  async function verify() {
    if (!result) return;
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: result.sessionId, useHttpBoundary }),
    });
    setVerifyReport(await res.json());
  }

  async function tamperAndReverify() {
    if (!result) return;
    await fetch("/api/tamper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: result.sessionId }),
    });
    setTampered(true);
    await verify();
  }

  async function requestOverride(targetId: string, factKey: string) {
    if (!result || !session) return;
    const res = await fetch("/api/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: result.sessionId, targetId, factKey, token: session.token }),
    });
    const data = await res.json();
    setOverrides((prev) => ({ ...prev, [overrideKey(targetId, factKey)]: data }));
  }

  const secondsLeft = session ? Math.max(0, Math.round((session.expiresAt - now) / 1000)) : 0;

  return (
    <div className="wrap">
      <h1>Agent Boundary Demo</h1>
      <p className="subtitle">
        External enforcement gateway + participant-aware output gate + closed-world grounding + independently replayable,
        hash-chained audit trail — every action tied to a signed identity token, not a trusted string.
      </p>

      <div className="panel">
        <h2>Session</h2>
        {!session ? (
          <div className="row">
            <select value={selectedPersona} onChange={(e) => setSelectedPersona(e.target.value)}>
              {org.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {e.role}
                </option>
              ))}
            </select>
            <button className="primary" onClick={login}>Log in</button>
          </div>
        ) : (
          <div className="row">
            <span className="badge allow">
              Authenticated as {org.find((e) => e.id === session.subjectId)?.name ?? session.subjectId}
            </span>
            <span className="mono" style={{ fontSize: 12 }}>
              token expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </span>
            <button className="danger" onClick={forgeAndTest}>Forge token &amp; test</button>
            <button onClick={() => setSession(null)}>Log out</button>
          </div>
        )}
        {authError && <p className="narrative" style={{ marginTop: 10, color: authError.startsWith("Rejected") ? "var(--allow)" : "var(--deny)" }}>{authError}</p>}
        {!session && <p className="empty" style={{ marginTop: 10 }}>Log in as an org member to run scenarios — every request now has to prove who it's acting as.</p>}
      </div>

      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.id} className={result?.scenario === s.id ? "primary" : ""} onClick={() => runScenario(s.id)} disabled={loading || !session}>
            {s.label}
            <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 400 }}>{s.hint}</div>
          </button>
        ))}
      </div>

      <label className="row" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 20, cursor: "pointer" }}>
        <input type="checkbox" checked={preemptive} onChange={(e) => setPreemptive(e.target.checked)} />
        Pre-emptive block for scenario 3 (deny at fetch time when the recipient is already known, instead of fetch-then-redact)
      </label>

      {loading && <p className="empty">Running…</p>}

      {result && (
        <>
          {result.anomalies && result.anomalies.length > 0 && (
            <div className="panel" style={{ borderColor: "var(--deny)" }}>
              <h2 style={{ color: "var(--deny)" }}>⚠ Anomaly detected</h2>
              {result.anomalies.map((a, i) => (
                <p className="narrative" key={i} style={{ color: "var(--text)" }}>{a.reason}</p>
              ))}
            </div>
          )}

          <div className="panel">
            <h2>What happened</h2>
            <p className="narrative">{result.narrative}</p>

            {result.injectionAttempt && (
              <div className="injection-box">
                <strong>Embedded instruction found in source text:</strong>
                <pre style={{ marginTop: 6 }}>{result.injectionAttempt.text}</pre>
              </div>
            )}

            <h2 style={{ marginTop: 16 }}>Draft (before gates)</h2>
            <pre>{result.draftText}</pre>

            <h2 style={{ marginTop: 16 }}>Delivered (after gates)</h2>
            <pre>{result.finalText}</pre>

            {result.blocked.length > 0 && (
              <div className="blocked-list">
                {result.blocked.map((b, i) => {
                  const key = overrideKey(b.targetId, b.factKey);
                  const ov = overrides[key];
                  return (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div className="blocked-item">⛔ {b.factKey} for {b.targetId}: {b.reason}</div>
                      {ov?.granted ? (
                        <div className="verdict" style={{ marginTop: 4 }}>
                          <span className="stamp allow" style={{ display: "inline-block", fontSize: 11, padding: "3px 8px", borderRadius: 4 }}>
                            Override granted
                          </span>{" "}
                          {ov.message} — value: <span className="mono">{ov.value}</span>
                        </div>
                      ) : (
                        <div className="row" style={{ marginTop: 4, gap: 8 }}>
                          <button onClick={() => requestOverride(b.targetId, b.factKey)} disabled={!session}>
                            Dual-control override sign-off (as {session ? org.find((e) => e.id === session.subjectId)?.name : "—"})
                          </button>
                          {ov && <span style={{ fontSize: 12, color: "var(--muted)" }}>{ov.message}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="empty" style={{ marginTop: 6 }}>
                  Overriding requires two DIFFERENT authenticated approvers — log in as another org member above and sign off again.
                </p>
              </div>
            )}

            {result.ungrounded && result.ungrounded.length > 0 && (
              <div className="blocked-list">
                <div className="panel-title" style={{ marginTop: 10 }}>Ungrounded content blocked</div>
                {result.ungrounded.map((line, i) => (
                  <div className="blocked-item" key={i}>⛔ "{line}"</div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Human approval</h2>
            <div className="row">
              <button className="primary" onClick={() => approve("approved")} disabled={!!approval || !session}>
                Approve
              </button>
              <button className="danger" onClick={() => approve("rejected")} disabled={!!approval || !session}>
                Reject
              </button>
              {approval && <span className="badge allow">{approval} by {session ? org.find((e) => e.id === session.subjectId)?.name : ""}</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Audit trace ({result.sessionId.slice(0, 8)})</h2>
            <div className="trace-row trace-header">
              <div>#</div>
              <div>type</div>
              <div>actor</div>
              <div>target</div>
              <div>fact</div>
              <div>decision / reason</div>
            </div>
            {result.trace.map((e) => (
              <div className="trace-row" key={e.seq}>
                <div className="mono">{e.seq}</div>
                <div className="mono">{e.type}</div>
                <div className="mono">{e.actorId}</div>
                <div className="mono">{e.targetId ?? "—"}</div>
                <div className="mono">{e.factKey ?? "—"}</div>
                <div>
                  {e.decision && <span className={`badge ${e.decision === "allowed" ? "allow" : "deny"}`}>{e.decision}</span>}
                  {e.reason ?? e.note}
                  {e.value && <span className="mono"> — "{e.value}"</span>}
                  {e.hash && <span className="mono" style={{ opacity: 0.5 }}> · hash {e.hash.slice(0, 10)}…</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Verifiable replay</h2>
            <label className="row" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={useHttpBoundary} onChange={(e) => setUseHttpBoundary(e.target.checked)} />
              Verify via internal HTTP policy endpoint instead of in-process (the gate as its own callable boundary)
            </label>
            <div className="row" style={{ marginBottom: 10 }}>
              <button onClick={verify}>Run replay verifier</button>
              <button className="danger" onClick={tamperAndReverify}>
                Tamper a denied entry → re-verify
              </button>
              {tampered && <span className="badge deny">trace tampered on disk</span>}
            </div>
            {verifyReport && (
              <>
                <p className={`verify-summary ${verifyReport.ok ? "ok" : "fail"}`}>
                  {verifyReport.ok
                    ? `✅ ${verifyReport.matched}/${verifyReport.totalSteps} policy steps matched (via ${verifyReport.checkedVia}), and the hash chain is intact.`
                    : `❌ ${verifyReport.mismatched}/${verifyReport.totalSteps} policy step(s) mismatched, hash chain ${verifyReport.chain.ok ? "intact" : "BROKEN"} — tampering detected.`}
                </p>
                <div className="trace-row trace-header">
                  <div>#</div>
                  <div>type</div>
                  <div>actor</div>
                  <div>target</div>
                  <div>fact</div>
                  <div>detail</div>
                </div>
                {verifyReport.steps.map((s) => {
                  const chainStep = verifyReport.chain.steps.find((c) => c.seq === s.seq);
                  const chainBroken = chainStep && !(chainStep.linkageOk && chainStep.contentOk);
                  return (
                    <div className={`trace-row ${s.match ? "" : "mismatch"}`} key={s.seq}>
                      <div className="mono">{s.seq}</div>
                      <div className="mono">{s.type}</div>
                      <div className="mono">{s.actorId}</div>
                      <div className="mono">{s.targetId ?? "—"}</div>
                      <div className="mono">{s.factKey ?? "—"}</div>
                      <div>
                        <span className={`badge ${s.match ? "allow" : "deny"}`}>{s.match ? "policy match" : "POLICY MISMATCH"}</span>
                        {chainBroken && <span className="badge deny">CHAIN BROKEN</span>}
                        {s.detail}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {!result && !loading && <p className="empty">Log in, then pick a scenario above to start.</p>}

      <div className="panel">
        <h2>Fairness &amp; precedent check</h2>
        <p className="narrative">
          A transparent, deterministic second opinion for a human reviewer — not an automated judgment. It scores each
          write-up's tone with a small, inspectable word list and compares it against how similar-rated write-ups have
          historically read company-wide. It does not touch ratings or stack rank; it only flags when a draft's language
          doesn't match its own rating's precedent, so a reviewer can look closer.
        </p>

        {!consistency && <p className="empty">Loading…</p>}

        {consistency && (
          <>
            <div className="trace-row trace-header">
              <div style={{ gridColumn: "span 1" }}>employee</div>
              <div style={{ gridColumn: "span 1" }}>rating</div>
              <div style={{ gridColumn: "span 1" }}>score</div>
              <div style={{ gridColumn: "span 1" }}>historic band</div>
              <div style={{ gridColumn: "span 2" }}>note</div>
            </div>
            {consistency.precedent.map((p) => (
              <div
                className="trace-row"
                key={p.employeeId}
                style={{ gridTemplateColumns: "minmax(0,120px) minmax(0,150px) minmax(0,60px) minmax(0,110px) minmax(0,1fr)" }}
              >
                <div>{p.employeeName}</div>
                <div className="mono">{p.rating}</div>
                <div className="mono">{p.score}</div>
                <div className="mono">
                  {p.band ? `${p.band.min} to ${p.band.max} (n=${p.band.sampleSize})` : "—"}
                </div>
                <div>
                  <span className={`badge ${p.withinBand ? "allow" : "deny"}`}>{p.withinBand ? "consistent" : "flagged"}</span>
                  {p.note}
                </div>
              </div>
            ))}

            <h2 style={{ marginTop: 20 }}>Historic precedent this was checked against</h2>
            {Object.entries(consistency.bands).map(([rating, band]) => (
              <div key={rating} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>
                  <strong style={{ color: "var(--text)" }}>{rating}</strong> — tone range {band.min} to {band.max} across {band.sampleSize} mock historic cycles
                </div>
                {band.examples.map((ex, i) => (
                  <div key={i} className="mono" style={{ fontSize: 11.5, marginLeft: 12 }}>
                    [{ex.cycle} · {ex.team} · score {ex.score}] {ex.text}
                  </div>
                ))}
              </div>
            ))}

            <h2 style={{ marginTop: 20 }}>Name-swap sanity check</h2>
            <p className="narrative">
              Same facts for {consistency.nameSwap.employeeId}, only the recipient's name changed. Today's drafting is
              template-based, so this checks that the scoring layer itself doesn't use identity as a signal — it doesn't.
              The moment real free-text generation is wired in for drafting, this exact same swap test should run against
              its output before anything ships, since that's where name-driven bias actually tends to show up.
            </p>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className={`badge ${consistency.nameSwap.allIdentical ? "allow" : "deny"}`}>
                {consistency.nameSwap.allIdentical ? "identical across all names" : "SCORES DIVERGED"}
              </span>
            </div>
            {consistency.nameSwap.variants.map((v) => (
              <div key={v.name} className="mono" style={{ fontSize: 11.5, marginBottom: 2 }}>
                {v.name.padEnd(16, " ")} → score {v.score}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

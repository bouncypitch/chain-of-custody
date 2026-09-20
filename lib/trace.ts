import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { TraceEvent } from "./types";

const TRACE_DIR = path.join(process.cwd(), "data", "traces");
const GENESIS = "0".repeat(64);

function ensureDir() {
  if (!fs.existsSync(TRACE_DIR)) fs.mkdirSync(TRACE_DIR, { recursive: true });
}

function filePath(sessionId: string): string {
  return path.join(TRACE_DIR, `${sessionId}.json`);
}

/**
 * Each entry's hash covers its own content plus the previous entry's hash —
 * a hash chain, not just a signature. Editing an entry's content on disk
 * without recomputing this hash (the realistic tamper: someone opens the JSON
 * file and changes a field) makes the stored hash stop matching a fresh
 * recompute of that entry's content. This is independent of, and stronger
 * than, the policy replay check: it doesn't need to know anything about
 * access-control policy to catch that a record was altered.
 */
function computeHash(prevHash: string, event: Omit<TraceEvent, "hash">): string {
  const canonical = JSON.stringify({ ...event, prevHash });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function startSession(scenarioId: string): string {
  ensureDir();
  const sessionId = crypto.randomUUID();
  const base: Omit<TraceEvent, "hash"> = {
    seq: 0,
    timestamp: new Date().toISOString(),
    type: "session_start",
    actorId: "system",
    note: `scenario=${scenarioId}`,
    prevHash: GENESIS,
  };
  const initial: TraceEvent = { ...base, hash: computeHash(GENESIS, base) };
  fs.writeFileSync(filePath(sessionId), JSON.stringify([initial], null, 2));
  return sessionId;
}

export function appendEvent(sessionId: string, event: Omit<TraceEvent, "seq" | "timestamp" | "prevHash" | "hash">): TraceEvent {
  const trace = getTrace(sessionId);
  const prevHash = trace.length > 0 ? trace[trace.length - 1].hash ?? GENESIS : GENESIS;
  const base: Omit<TraceEvent, "hash"> = {
    ...event,
    seq: trace.length,
    timestamp: new Date().toISOString(),
    prevHash,
  };
  const full: TraceEvent = { ...base, hash: computeHash(prevHash, base) };
  trace.push(full);
  fs.writeFileSync(filePath(sessionId), JSON.stringify(trace, null, 2));
  return full;
}

export function getTrace(sessionId: string): TraceEvent[] {
  const p = filePath(sessionId);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export interface ChainVerifyStep {
  seq: number;
  linkageOk: boolean; // stored prevHash matches previous entry's stored hash
  contentOk: boolean; // recomputed hash from current content matches stored hash
}

export interface ChainVerifyReport {
  ok: boolean;
  steps: ChainVerifyStep[];
}

/** Recomputes the chain fresh from stored content — a second, independent tamper signal from the policy replay check. */
export function verifyChain(sessionId: string): ChainVerifyReport {
  const trace = getTrace(sessionId);
  const steps: ChainVerifyStep[] = [];

  for (let i = 0; i < trace.length; i++) {
    const entry = trace[i];
    const { hash, ...rest } = entry;
    const expectedPrev = i === 0 ? GENESIS : trace[i - 1].hash ?? GENESIS;
    const linkageOk = entry.prevHash === expectedPrev;
    const recomputed = computeHash(entry.prevHash ?? GENESIS, rest);
    const contentOk = recomputed === hash;
    steps.push({ seq: entry.seq, linkageOk, contentOk });
  }

  return { ok: steps.every((s) => s.linkageOk && s.contentOk), steps };
}

/** For the "tamper & re-verify" demo: mutates a recorded event's content in place WITHOUT
 * recomputing its hash — the realistic case of someone editing the JSON file on disk. */
export function tamperTrace(sessionId: string): { tampered: boolean; seq?: number; before?: TraceEvent; after?: TraceEvent } {
  const trace = getTrace(sessionId);
  const target = [...trace].reverse().find((e) => e.type === "gateway_fetch" && e.decision === "denied");
  if (!target) return { tampered: false };
  const before = { ...target };
  target.decision = "allowed";
  target.reason = "(tampered) access was actually granted";
  target.value = "TAMPERED VALUE — this was never legitimately released";
  // hash and prevHash deliberately left untouched — that's what makes both checks catch it
  fs.writeFileSync(filePath(sessionId), JSON.stringify(trace, null, 2));
  return { tampered: true, seq: target.seq, before, after: { ...target } };
}

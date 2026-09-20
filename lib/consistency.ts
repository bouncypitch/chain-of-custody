import fs from "fs";
import path from "path";
import { getOrgMap, getReviews } from "./data";

/**
 * A small, transparent lexicon — not a model. Every score this produces is
 * explainable by pointing at exactly which words matched. This is deliberately
 * simple: it's a "second opinion" signal for a human reviewer, not an automated
 * judgment, and it says so wherever it's shown.
 */
const POSITIVE_STEMS = ["exceed", "excellent", "great", "strong", "reliable", "ready", "promot", "mentor", "deliver", "solid", "ahead", "lead"];
const NEGATIVE_STEMS = ["difficult", "below", "rough", "need", "ramp", "behind", "struggl", "concern", "risk", "pressure"];

/** Word-boundary prefix match (e.g. "deliver" matches "delivered") — a plain
 * substring search would also match "rough" inside "through", which is wrong. */
function stemMatches(text: string, stem: string): boolean {
  return new RegExp(`\\b${stem}`, "i").test(text);
}

export function toneScore(text: string): { score: number; positiveHits: string[]; negativeHits: string[] } {
  const positiveHits = POSITIVE_STEMS.filter((w) => stemMatches(text, w));
  const negativeHits = NEGATIVE_STEMS.filter((w) => stemMatches(text, w));
  const pos = positiveHits.length;
  const neg = negativeHits.length;
  const total = pos + neg;
  const score = total === 0 ? 0 : (pos - neg) / total;
  return { score: Math.round(score * 100) / 100, positiveHits, negativeHits };
}

export interface HistoricEntry {
  ratingLevel: string;
  cycle: string;
  team: string;
  text: string;
}

interface Band {
  min: number;
  max: number;
  sampleSize: number;
  examples: { cycle: string; team: string; text: string; score: number }[];
}

let historicCache: HistoricEntry[] | null = null;
function getHistoric(): HistoricEntry[] {
  if (!historicCache) {
    historicCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "historicCycles.json"), "utf-8"));
  }
  return historicCache!;
}

export function computeBands(): Record<string, Band> {
  const bands: Record<string, Band> = {};
  for (const entry of getHistoric()) {
    const { score } = toneScore(entry.text);
    if (!bands[entry.ratingLevel]) {
      bands[entry.ratingLevel] = { min: score, max: score, sampleSize: 0, examples: [] };
    }
    const b = bands[entry.ratingLevel];
    b.min = Math.min(b.min, score);
    b.max = Math.max(b.max, score);
    b.sampleSize += 1;
    b.examples.push({ cycle: entry.cycle, team: entry.team, text: entry.text, score });
  }
  return bands;
}

export interface PrecedentResult {
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

export function runFairnessReport(): PrecedentResult[] {
  const org = getOrgMap();
  const reviews = getReviews();
  const bands = computeBands();
  const results: PrecedentResult[] = [];

  for (const [employeeId, record] of Object.entries(reviews)) {
    const rating = record.facts.rating?.value;
    const text = record.facts.managerNote?.value;
    if (!rating || !text) continue;

    const { score, positiveHits, negativeHits } = toneScore(text);
    const band = bands[rating] ?? null;
    const withinBand = band ? score >= band.min && score <= band.max : true;

    let note: string;
    if (!band) {
      note = "No historic precedent recorded for this rating level.";
    } else if (withinBand) {
      note = `Consistent with how ${band.sampleSize} historic "${rating}" write-ups have read (tone range ${band.min} to ${band.max}).`;
    } else if (score > band.max) {
      note = `Reads more positively (${score}) than the historic "${rating}" range (${band.min} to ${band.max}, n=${band.sampleSize}) — worth checking whether the rating should be higher, or the language toned down to match.`;
    } else {
      note = `Reads more negatively (${score}) than the historic "${rating}" range (${band.min} to ${band.max}, n=${band.sampleSize}) — worth checking whether unrelated context (e.g. a personal note) is coloring the tone, or the rating doesn't match the narrative.`;
    }

    results.push({
      employeeId,
      employeeName: org[employeeId]?.name ?? employeeId,
      rating,
      text,
      score,
      positiveHits,
      negativeHits,
      band: band ? { min: band.min, max: band.max, sampleSize: band.sampleSize } : null,
      withinBand,
      note,
    });
  }

  return results;
}

export interface NameSwapResult {
  employeeId: string;
  variants: { name: string; draftText: string; score: number }[];
  allIdentical: boolean;
}

const ALT_NAMES = ["Amara Osei", "Wei Chen", "Sofia Martinez", "Liam O'Connor"];

/**
 * Re-renders the same share-back draft with only the salutation/signature name
 * swapped — the underlying facts (and therefore the substance of the text) are
 * untouched. Confirms the tone score doesn't move just because the name did.
 * This checks the SCORING layer, which is name-blind by construction today
 * because drafting is templated. The moment a real LLM does the drafting
 * instead of a template, this exact same swap test should run against ITS
 * output before anything ships — that's where name-driven bias actually shows
 * up in practice, and the harness here is built to extend to it directly.
 */
export function nameSwapTest(employeeId: string): NameSwapResult | null {
  const reviews = getReviews();
  const org = getOrgMap();
  const record = reviews[employeeId];
  const realEmployee = org[employeeId];
  if (!record || !realEmployee) return null;

  const names = [realEmployee.name, ...ALT_NAMES];
  const variants = names.map((name) => {
    const draftText = [
      `Hi ${name},`,
      ``,
      `Here's a summary of your calibration feedback this cycle:`,
      `  - rating: ${record.facts.rating?.value}`,
      `  - managerNote: ${record.facts.managerNote?.value}`,
      `  - stackRank: ${record.facts.stackRank?.value}`,
    ].join("\n");
    return { name, draftText, score: toneScore(draftText).score };
  });

  const allIdentical = variants.every((v) => v.score === variants[0].score);
  return { employeeId, variants, allIdentical };
}

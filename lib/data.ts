import fs from "fs";
import path from "path";
import type { Employee, FactKey } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

export interface ReviewFacts {
  selfReviewText: string;
  facts: Partial<Record<FactKey, { value: string }>>;
}

export interface BusinessEvent {
  date: string;
  type: string;
  description: string;
}

let orgCache: Employee[] | null = null;
let reviewsCache: Record<string, ReviewFacts> | null = null;
let businessEventsCache: Record<string, BusinessEvent[]> | null = null;

export function getOrg(): Employee[] {
  if (!orgCache) {
    orgCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "org.json"), "utf-8"));
  }
  return orgCache!;
}

export function getOrgMap(): Record<string, Employee> {
  const map: Record<string, Employee> = {};
  for (const e of getOrg()) map[e.id] = e;
  return map;
}

export function getReviews(): Record<string, ReviewFacts> {
  if (!reviewsCache) {
    reviewsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "reviews.json"), "utf-8"));
  }
  return reviewsCache!;
}

export function getBusinessEvents(): Record<string, BusinessEvent[]> {
  if (!businessEventsCache) {
    businessEventsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "businessEvents.json"), "utf-8"));
  }
  return businessEventsCache!;
}

/**
 * businessEvents is a live feed (shipped features, incidents, escalations) rather
 * than a once-a-year write-up — it's formatted here into the same string-valued
 * fact shape everything else uses, so it flows through the identical input/output
 * gates as every other fact. Continuous inputs, same gated process.
 */
function formatBusinessEvents(targetId: string): string | undefined {
  const events = getBusinessEvents()[targetId];
  if (!events || events.length === 0) return undefined;
  return events.map((e) => `[${e.date} · ${e.type}] ${e.description}`).join("\n      ");
}

export function getFactValue(targetId: string, factKey: FactKey): string | undefined {
  if (factKey === "businessEvents") return formatBusinessEvents(targetId);
  return getReviews()[targetId]?.facts[factKey]?.value;
}

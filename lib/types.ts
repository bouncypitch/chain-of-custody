export type Role = "ic" | "manager" | "senior-manager" | "vp" | "hr";

export interface Employee {
  id: string;
  name: string;
  role: Role;
  managerId: string | null;
  team: string;
  juniorManager?: boolean;
}

export type FactKey = "rating" | "managerNote" | "compBand" | "stackRank" | "businessEvents";

export interface FactPolicy {
  label: string;
  managerOf: boolean;
  skipLevelOf: boolean;
  roles: Role[];
  requireSeniorManager?: boolean;
  visibleToSubject?: boolean;
  neverToSubject?: boolean;
}

export interface ViewDecision {
  allowed: boolean;
  reason: string;
}

export type TraceEventType =
  | "session_start"
  | "gateway_fetch"
  | "output_gate_check"
  | "grounding_check"
  | "anomaly_flag"
  | "approval"
  | "override_approval"
  | "override_granted";

export interface TraceEvent {
  seq: number;
  timestamp: string;
  type: TraceEventType;
  actorId: string;
  targetId?: string;
  factKey?: FactKey;
  decision?: "allowed" | "denied";
  reason?: string;
  value?: string; // only ever populated when decision === "allowed"
  note?: string;
  prevHash?: string;
  hash?: string;
}

export type ScenarioId = "happy-path" | "input-denial" | "output-leak" | "hallucination";

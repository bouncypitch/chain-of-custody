import { getOrgMap } from "./data";
import type { FactKey, FactPolicy, ViewDecision } from "./types";

export const FACT_POLICY: Record<FactKey, FactPolicy> = {
  rating: {
    label: "Performance rating",
    managerOf: true,
    skipLevelOf: true,
    roles: ["hr"],
    visibleToSubject: true,
  },
  managerNote: {
    label: "Manager's private note",
    managerOf: true,
    skipLevelOf: false,
    roles: ["hr"],
  },
  compBand: {
    label: "Compensation band",
    managerOf: true,
    skipLevelOf: false,
    roles: ["hr"],
    requireSeniorManager: true,
    visibleToSubject: true,
  },
  stackRank: {
    label: "Stack rank / peer comparison",
    managerOf: true,
    skipLevelOf: true,
    roles: ["hr"],
    neverToSubject: true,
  },
  businessEvents: {
    label: "Recent business-impact events",
    managerOf: true,
    skipLevelOf: true,
    roles: ["hr"],
    visibleToSubject: true,
  },
};

function isManagerOf(viewerId: string, targetId: string): boolean {
  const org = getOrgMap();
  return org[targetId]?.managerId === viewerId;
}

function isSkipLevelOf(viewerId: string, targetId: string): boolean {
  const org = getOrgMap();
  const target = org[targetId];
  if (!target?.managerId) return false;
  const manager = org[target.managerId];
  return manager?.managerId === viewerId;
}

/**
 * The single policy check used by BOTH enforcement points:
 * - the input-side gate calls this with viewerId = the caller fetching data
 * - the output-side gate calls this with viewerId = the recipient of the drafted reply
 * Same rule, evaluated against two different people, at two different moments.
 */
export function canView(viewerId: string, targetId: string, factKey: FactKey): ViewDecision {
  const org = getOrgMap();
  const viewer = org[viewerId];
  const policy = FACT_POLICY[factKey];

  if (!viewer) return { allowed: false, reason: `unknown viewer '${viewerId}'` };
  if (!org[targetId]) return { allowed: false, reason: `unknown subject '${targetId}'` };

  if (viewerId === targetId) {
    if (policy.neverToSubject) {
      return {
        allowed: false,
        reason: `policy explicitly forbids ever showing ${policy.label.toLowerCase()} to the employee it's about`,
      };
    }
    if (policy.visibleToSubject) {
      return { allowed: true, reason: `employees may always see their own ${policy.label.toLowerCase()}` };
    }
    return {
      allowed: false,
      reason: `no policy grants an employee direct access to their own ${policy.label.toLowerCase()}`,
    };
  }

  if (policy.roles.includes(viewer.role)) {
    return { allowed: true, reason: `role '${viewer.role}' has blanket access to ${policy.label.toLowerCase()}` };
  }

  if (policy.managerOf && isManagerOf(viewerId, targetId)) {
    if (policy.requireSeniorManager && viewer.role !== "senior-manager" && viewer.role !== "vp") {
      return {
        allowed: false,
        reason: `direct manager, but role '${viewer.role}' is below the seniority required for ${policy.label.toLowerCase()}`,
      };
    }
    return { allowed: true, reason: `direct manager of the subject` };
  }

  if (policy.skipLevelOf && isSkipLevelOf(viewerId, targetId)) {
    return { allowed: true, reason: `skip-level manager of the subject` };
  }

  return {
    allowed: false,
    reason: `no policy grants '${viewer.role}' (${viewerId}) access to ${policy.label.toLowerCase()} for ${targetId}`,
  };
}

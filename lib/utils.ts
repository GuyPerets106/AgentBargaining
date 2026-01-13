import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Issue, Offer, OfferAllocation } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function shortId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function allocationFromIssues(issues: Issue[], split: "equal" | "agent") {
  const allocation: OfferAllocation = {};
  issues.forEach((issue) => {
    const human = split === "equal" ? Math.floor(issue.total / 2) : 0;
    const agent = issue.total - human;
    allocation[issue.key] = { human, agent };
  });
  return allocation;
}

export function summarizeOffer(offer: OfferAllocation, issues: Issue[]) {
  return issues
    .map((issue) => {
      const entry = offer[issue.key];
      if (!entry) return "";
      return `${issue.label}: Human ${entry.human} / Agent ${entry.agent}`;
    })
    .filter(Boolean)
    .join("; ");
}

export function offerToPlainText(offer: OfferAllocation, issues: Issue[]) {
  return issues
    .map((issue) => {
      const entry = offer[issue.key];
      if (!entry) return "";
      return `${issue.label} (total ${issue.total}): Human ${entry.human}, Agent ${entry.agent}`;
    })
    .filter(Boolean)
    .join(". ");
}

/**
 * Compute weighted utilities based on asymmetric preferences.
 * This is the core of integrative negotiation - different valuations create trade opportunities.
 */
export function computeUtilities(
  allocation: OfferAllocation,
  weights: { human: Record<string, number>; agent: Record<string, number> }
) {
  let humanUtility = 0;
  let agentUtility = 0;

  for (const [issueKey, split] of Object.entries(allocation)) {
    const humanWeight = weights.human[issueKey] ?? 1;
    const agentWeight = weights.agent[issueKey] ?? 1;
    humanUtility += split.human * humanWeight;
    agentUtility += split.agent * agentWeight;
  }

  return {
    human: humanUtility,
    agent: agentUtility,
    joint: humanUtility + agentUtility,
  };
}

/**
 * Legacy unweighted utility calculation (just counts units).
 * Kept for backward compatibility.
 */
export function computeRawUtilities(allocation: OfferAllocation) {
  const values = Object.values(allocation).reduce(
    (acc, entry) => {
      acc.human += entry.human;
      acc.agent += entry.agent;
      return acc;
    },
    { human: 0, agent: 0 }
  );
  return { human: values.human, agent: values.agent, joint: values.human + values.agent };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function summarizeHistory(offers: Offer[], maxItems = 4) {
  const slice = offers.slice(-maxItems);
  return slice
    .map((offer) => {
      return `${offer.by} turn ${offer.turn}: ${Object.entries(offer.allocation)
        .map(([issue, allocation]) => `${issue} H${allocation.human}/A${allocation.agent}`)
        .join(", ")}`;
    })
    .join(" | ");
}

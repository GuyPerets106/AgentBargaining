import type { Issue } from "@/lib/types";
import weights from "@/lib/weights.json";

export const DEFAULT_ISSUES: Issue[] = [
  { key: "snacks", label: "Snack Packs", total: 8, icon: "Cookie" },
  { key: "breaks", label: "Break Minutes", total: 10, icon: "Coffee" },
  { key: "music", label: "Music Picks", total: 6, icon: "Music" },
  { key: "tickets", label: "Prize Tickets", total: 8, icon: "Ticket" },
];

/**
 * Utility weights define how much each party values each issue.
 * Asymmetric preferences create incentive for trade (logrolling).
 * 
 * Example: Human values snacks highly (3pts), agent values breaks highly (4pts).
 * A 50/50 split gives: Human = 4*3 + 5*1 + 3*2 + 4*1 = 21 pts
 *                      Agent = 4*1 + 5*4 + 3*2 + 4*3 = 42 pts
 * 
 * Optimal trade:       Human gets 8 snacks, 2 breaks, 4 music, 2 tickets = 36 pts
 *                      Agent gets 0 snacks, 8 breaks, 2 music, 6 tickets = 56 pts
 * Both sides gain from trading issues they value less for issues they value more!
 */
export const UTILITY_WEIGHTS = weights as {
  human: Record<string, number>;
  agent: Record<string, number>;
};

export const DEFAULT_DOMAIN = {
  domain_id: "classroom-perks-01",
  issues: DEFAULT_ISSUES,
  deadline_seconds: 6 * 60,
  max_turns: 12,
};

export const PERSONA_TAGS = [
  "friendly-cooperative",
  "tough-businesslike",
  "curious-analytical",
];

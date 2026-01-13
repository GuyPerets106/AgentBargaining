import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import weightsJson from "@/lib/weights.json";
import type { ExperimentEvent, ExperimentSession, Offer, OfferAllocation } from "@/lib/types";

export const dynamic = "force-dynamic";

type WeightMap = Record<string, number>;
type Weights = { human: WeightMap; agent: WeightMap };

type WeightedUtility = {
  human: number;
  agent: number;
  joint: number;
};

type AllocationPoint = {
  allocation: OfferAllocation;
  utilities: WeightedUtility;
};

type AllocationStats = {
  allocations: AllocationPoint[];
  frontierSet: Set<string>;
  nash: { best: AllocationPoint | null; bestValue: number };
  maxJoint: number | null;
};

const weights = (weightsJson as Weights) ?? { human: {}, agent: {} };

function computeWeightedUtility(allocation: OfferAllocation, weightConfig: Weights) {
  let human = 0;
  let agent = 0;
  Object.entries(allocation || {}).forEach(([issue, split]) => {
    const humanWeight = weightConfig.human[issue] ?? 1;
    const agentWeight = weightConfig.agent[issue] ?? 1;
    human += (split?.human ?? 0) * humanWeight;
    agent += (split?.agent ?? 0) * agentWeight;
  });
  return { human, agent, joint: human + agent };
}

function computeMaxJointUtility(session: ExperimentSession, weightConfig: Weights) {
  const issues = session.config?.issues ?? [];
  if (!issues.length) return null;
  return issues.reduce((sum, issue) => {
    const humanWeight = weightConfig.human[issue.key] ?? 1;
    const agentWeight = weightConfig.agent[issue.key] ?? 1;
    return sum + issue.total * Math.max(humanWeight, agentWeight);
  }, 0);
}

function generateAllocations(issues: ExperimentSession["config"]["issues"]) {
  const results: OfferAllocation[] = [];
  const recurse = (index: number, current: OfferAllocation) => {
    if (index >= issues.length) {
      results.push(JSON.parse(JSON.stringify(current)));
      return;
    }
    const issue = issues[index];
    for (let human = 0; human <= issue.total; human += 1) {
      current[issue.key] = { human, agent: issue.total - human };
      recurse(index + 1, current);
    }
  };
  recurse(0, {});
  return results;
}

function computeParetoFrontier(points: AllocationPoint[]) {
  const sorted = [...points].sort((a, b) => {
    if (b.utilities.human !== a.utilities.human) {
      return b.utilities.human - a.utilities.human;
    }
    return b.utilities.agent - a.utilities.agent;
  });
  const frontier: AllocationPoint[] = [];
  let maxAgent = -Infinity;
  for (const point of sorted) {
    if (point.utilities.agent > maxAgent) {
      frontier.push(point);
      maxAgent = point.utilities.agent;
    }
  }
  return frontier;
}

function computeNashPoint(points: AllocationPoint[]) {
  let best: AllocationPoint | null = null;
  let bestValue = -Infinity;
  for (const point of points) {
    const value = point.utilities.human * point.utilities.agent;
    if (value > bestValue) {
      bestValue = value;
      best = point;
    }
  }
  return { best, bestValue };
}

const allocationCache = new Map<string, AllocationStats>();

function getAllocationStats(
  issues: ExperimentSession["config"]["issues"],
  weightConfig: Weights
) {
  const key = JSON.stringify(issues.map((issue) => ({ key: issue.key, total: issue.total })));
  if (allocationCache.has(key)) {
    return allocationCache.get(key) as AllocationStats;
  }
  const allocations = generateAllocations(issues).map((allocation) => ({
    allocation,
    utilities: computeWeightedUtility(allocation, weightConfig),
  }));
  const frontier = computeParetoFrontier(allocations);
  const frontierSet = new Set(
    frontier.map((point) => `${point.utilities.human}|${point.utilities.agent}`)
  );
  const nash = computeNashPoint(allocations);
  const maxJoint =
    issues.length > 0
      ? issues.reduce((sum, issue) => {
          const humanWeight = weightConfig.human[issue.key] ?? 1;
          const agentWeight = weightConfig.agent[issue.key] ?? 1;
          return sum + issue.total * Math.max(humanWeight, agentWeight);
        }, 0)
      : null;
  const stats = { allocations, frontierSet, nash, maxJoint };
  allocationCache.set(key, stats);
  return stats;
}

function getEvents(session: ExperimentSession) {
  return Array.isArray(session.events) ? session.events : [];
}

function collectOffers(events: ExperimentEvent[]) {
  return events
    .filter((event) => event.type === "offer_propose" || event.type === "offer_receive")
    .map((event) => {
      const payload = event.payload as { offer?: Offer };
      const offer = payload?.offer;
      if (!offer?.allocation) return null;
      return {
        ...offer,
        by: offer.by ?? (event.type === "offer_propose" ? "human" : "agent"),
        t: event.t,
      };
    })
    .filter((offer): offer is Offer & { t?: string } => Boolean(offer));
}

function collectChats(events: ExperimentEvent[]) {
  return events
    .filter((event) => event.type === "chat_send" || event.type === "chat_receive")
    .map((event) => ({
      role: event.type === "chat_send" ? "human" : "agent",
      t: event.t,
      content: String((event.payload as { content?: string })?.content ?? ""),
    }));
}

function computeOfferLatencies(offers: Array<Offer & { t?: string }>) {
  const pairs: number[] = [];
  const byTurn = new Map<string, Offer & { t?: string }>();
  offers.forEach((offer) => {
    const key = `${offer.turn}-${offer.by}`;
    byTurn.set(key, offer);
  });
  offers
    .filter((offer) => offer.by === "human")
    .forEach((offer) => {
      const agentOffer = byTurn.get(`${offer.turn + 1}-agent`);
      if (agentOffer?.created_at && offer.created_at) {
        const latency =
          (Date.parse(agentOffer.created_at) - Date.parse(offer.created_at)) / 1000;
        if (!Number.isNaN(latency)) {
          pairs.push(latency);
        }
      }
    });
  return pairs;
}

function getOfferTime(offer: Offer & { t?: string }) {
  const stamp = offer.created_at ?? offer.t ?? "";
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortOffers(offers: Array<Offer & { t?: string }>) {
  return [...offers].sort((a, b) => {
    const turnDiff = (a.turn ?? 0) - (b.turn ?? 0);
    if (turnDiff !== 0) return turnDiff;
    return getOfferTime(a) - getOfferTime(b);
  });
}

function computeConcessions(offers: Array<Offer & { t?: string }>, weightConfig: Weights) {
  const byRole: Record<"human" | "agent", Array<Record<string, number | string | null>>> = {
    human: [],
    agent: [],
  };

  sortOffers(offers).forEach((offer) => {
    if (!offer?.allocation || !offer?.by) return;
    const utilities = computeWeightedUtility(offer.allocation, weightConfig);
    const own = offer.by === "human" ? utilities.human : utilities.agent;
    const opponent = offer.by === "human" ? utilities.agent : utilities.human;
    byRole[offer.by].push({
      turn: offer.turn ?? "",
      created_at: offer.created_at ?? offer.t ?? "",
      own_utility: own,
      opponent_utility: opponent,
      joint_utility: utilities.joint,
    });
  });

  const rows: Array<Record<string, number | string | null>> = [];
  Object.entries(byRole).forEach(([by, roleOffers]) => {
    let previousOwn: number | null = null;
    let cumulative = 0;
    roleOffers.forEach((offer) => {
      const ownUtility = Number(offer.own_utility ?? 0);
      let concession: number | null = null;
      if (previousOwn !== null) {
        concession = previousOwn - ownUtility;
        cumulative += concession;
      }
      rows.push({
        by,
        turn: offer.turn ?? "",
        created_at: offer.created_at ?? "",
        own_utility: offer.own_utility ?? null,
        opponent_utility: offer.opponent_utility ?? null,
        joint_utility: offer.joint_utility ?? null,
        concession,
        cumulative_concession: previousOwn === null ? null : cumulative,
        own_share:
          offer.joint_utility && typeof offer.own_utility === "number"
            ? Number(offer.own_utility) / Number(offer.joint_utility)
            : null,
      });
      previousOwn = ownUtility;
    });
  });
  return rows;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "data");
    let entries: Array<import("fs").Dirent> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    const sessions = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join(dir, filename);
        const [raw, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
        const data = JSON.parse(raw) as ExperimentSession;
        return { filename, stored_at: stats.mtime.toISOString(), session: data };
      })
    );

    const sessionRows: Array<Record<string, unknown>> = [];
    const offerRows: Array<Record<string, unknown>> = [];
    const chatRows: Array<Record<string, unknown>> = [];
    const surveyRows: Array<Record<string, unknown>> = [];
    const concessionRows: Array<Record<string, unknown>> = [];

    const conditionCounts: Record<string, number> = {};
    const agreementRates: Record<string, number[]> = {};
    const jointUtilities: Record<string, number[]> = {};
    const fairnessIndexes: Record<string, number[]> = {};
    const efficiencies: Record<string, number[]> = {};
    const nashProducts: Record<string, number[]> = {};
    const nashRatios: Record<string, number[]> = {};
    const nashDistances: Record<string, number[]> = {};
    const paretoRates: Record<string, number[]> = {};
    const humanShares: Record<string, number[]> = {};
    const durations: Record<string, number[]> = {};
    const turnCounts: Record<string, number[]> = {};
    const responseLatencies: Record<string, number[]> = {};
    const humanConcessions: Record<string, number[]> = {};
    const agentConcessions: Record<string, number[]> = {};
    const concessionCurveMap = new Map<
      string,
      {
        condition_id: string;
        persona_tag: string;
        by: string;
        turn: number | string;
        concessions: number[];
        cumulative: number[];
        own_utilities: number[];
        opponent_utilities: number[];
      }
    >();

    sessions.forEach(({ filename, stored_at, session }) => {
      const events = getEvents(session);
      const offers = collectOffers(events);
      const chats = collectChats(events);
      const outcome = session.outcome ?? {};
      const conditionId = session.condition?.id ?? "unknown";
      const personaTag = session.condition?.persona_tag ?? "";
      const issues = session.config?.issues ?? [];
      const allocationStats = issues.length ? getAllocationStats(issues, weights) : null;
      const maxJoint = allocationStats?.maxJoint ?? computeMaxJointUtility(session, weights);

      conditionCounts[conditionId] = (conditionCounts[conditionId] ?? 0) + 1;

      const agreement = outcome.reason === "agreement";
      const agreedAllocation = outcome.agreed_offer?.allocation ?? null;
      const utilities = agreedAllocation
        ? computeWeightedUtility(agreedAllocation, weights)
        : { human: null, agent: null, joint: null };

      const fairnessIndex =
        utilities.joint && utilities.human !== null && utilities.agent !== null
          ? 1 - Math.abs(utilities.human - utilities.agent) / utilities.joint
          : null;
      const efficiency = maxJoint && utilities.joint ? utilities.joint / maxJoint : null;
      const nashProduct =
        utilities.human !== null && utilities.agent !== null
          ? utilities.human * utilities.agent
          : null;
      const nashMax = allocationStats?.nash?.bestValue ?? null;
      const nashRatio = nashMax && nashProduct !== null ? nashProduct / nashMax : null;
      const nashPoint = allocationStats?.nash?.best?.utilities ?? null;
      const nashDistance =
        nashPoint && utilities.human !== null && utilities.agent !== null
          ? Math.sqrt(
              (utilities.human - nashPoint.human) ** 2 +
                (utilities.agent - nashPoint.agent) ** 2
            )
          : null;
      const paretoEfficient =
        allocationStats && utilities.human !== null && utilities.agent !== null
          ? allocationStats.frontierSet.has(`${utilities.human}|${utilities.agent}`)
          : null;
      const humanShare =
        utilities.joint && utilities.human !== null ? utilities.human / utilities.joint : null;

      agreementRates[conditionId] = agreementRates[conditionId] || [];
      agreementRates[conditionId].push(agreement ? 1 : 0);
      jointUtilities[conditionId] = jointUtilities[conditionId] || [];
      if (utilities.joint !== null) jointUtilities[conditionId].push(utilities.joint);
      fairnessIndexes[conditionId] = fairnessIndexes[conditionId] || [];
      if (fairnessIndex !== null) fairnessIndexes[conditionId].push(fairnessIndex);
      efficiencies[conditionId] = efficiencies[conditionId] || [];
      if (efficiency !== null) efficiencies[conditionId].push(efficiency);
      nashProducts[conditionId] = nashProducts[conditionId] || [];
      if (nashProduct !== null) nashProducts[conditionId].push(nashProduct);
      nashRatios[conditionId] = nashRatios[conditionId] || [];
      if (nashRatio !== null) nashRatios[conditionId].push(nashRatio);
      nashDistances[conditionId] = nashDistances[conditionId] || [];
      if (nashDistance !== null) nashDistances[conditionId].push(nashDistance);
      paretoRates[conditionId] = paretoRates[conditionId] || [];
      if (paretoEfficient !== null) paretoRates[conditionId].push(paretoEfficient ? 1 : 0);
      humanShares[conditionId] = humanShares[conditionId] || [];
      if (humanShare !== null) humanShares[conditionId].push(humanShare);
      durations[conditionId] = durations[conditionId] || [];
      if (outcome.duration_seconds !== undefined) durations[conditionId].push(outcome.duration_seconds);
      turnCounts[conditionId] = turnCounts[conditionId] || [];
      if (outcome.turns !== undefined) turnCounts[conditionId].push(outcome.turns);

      const latencies = computeOfferLatencies(offers);
      responseLatencies[conditionId] = responseLatencies[conditionId] || [];
      responseLatencies[conditionId].push(...latencies);

      const concessions = computeConcessions(offers, weights);
      concessions.forEach((row) => {
        const enriched = {
          session_id: session.session_id,
          condition_id: conditionId,
          persona_tag: personaTag,
          ...row,
        };
        concessionRows.push(enriched);
        if (row.concession === null || typeof row.concession !== "number") return;
        const bucket = row.by === "human" ? humanConcessions : agentConcessions;
        bucket[conditionId] = bucket[conditionId] || [];
        bucket[conditionId].push(row.concession);
        const key = `${conditionId}|${personaTag}|${row.by}|${row.turn}`;
        const entry =
          concessionCurveMap.get(key) || {
            condition_id: conditionId,
            persona_tag: personaTag,
            by: String(row.by),
            turn: row.turn ?? "",
            concessions: [],
            cumulative: [],
            own_utilities: [],
            opponent_utilities: [],
          };
        entry.concessions.push(row.concession);
        entry.cumulative.push(typeof row.cumulative_concession === "number" ? row.cumulative_concession : 0);
        entry.own_utilities.push(typeof row.own_utility === "number" ? row.own_utility : 0);
        entry.opponent_utilities.push(typeof row.opponent_utility === "number" ? row.opponent_utility : 0);
        concessionCurveMap.set(key, entry);
      });

      sessionRows.push({
        session_id: session.session_id,
        participant_id: session.participant?.participant_id ?? "",
        condition_id: conditionId,
        persona_tag: personaTag,
        created_at: session.created_at,
        stored_at,
        outcome_reason: outcome.reason ?? "",
        agreement: agreement ? "yes" : "no",
        duration_seconds: outcome.duration_seconds ?? "",
        turns: outcome.turns ?? "",
        offers_total: offers.length,
        offers_human: offers.filter((offer) => offer.by === "human").length,
        offers_agent: offers.filter((offer) => offer.by === "agent").length,
        chats_total: chats.length,
        chats_human: chats.filter((chat) => chat.role === "human").length,
        chats_agent: chats.filter((chat) => chat.role === "agent").length,
        weighted_human_utility: utilities.human ?? "",
        weighted_agent_utility: utilities.agent ?? "",
        weighted_joint_utility: utilities.joint ?? "",
        fairness_index: fairnessIndex ?? "",
        efficiency: efficiency ?? "",
        max_joint_utility: maxJoint ?? "",
        nash_product: nashProduct ?? "",
        nash_ratio: nashRatio ?? "",
        nash_distance: nashDistance ?? "",
        pareto_efficient:
          paretoEfficient === null ? "" : paretoEfficient ? "yes" : "no",
        human_share: humanShare ?? "",
        file: filename,
      });

      offers.forEach((offer) => {
        const offerUtilities = computeWeightedUtility(offer.allocation, weights);
        const row: Record<string, unknown> = {
          session_id: session.session_id,
          condition_id: conditionId,
          turn: offer.turn,
          by: offer.by,
          created_at: offer.created_at ?? offer.t ?? "",
          human_utility: offerUtilities.human,
          agent_utility: offerUtilities.agent,
          joint_utility: offerUtilities.joint,
        };
        for (const issue of session.config?.issues ?? []) {
          const allocation = offer.allocation?.[issue.key] ?? { human: 0, agent: 0 };
          row[`${issue.key}_human`] = allocation.human;
          row[`${issue.key}_agent`] = allocation.agent;
        }
        offerRows.push(row);
      });

      chats.forEach((chat) => {
        chatRows.push({
          session_id: session.session_id,
          condition_id: conditionId,
          role: chat.role,
          t: chat.t,
          content_length: chat.content.length,
          content: chat.content,
        });
      });

      if (session.survey) {
        surveyRows.push({
          session_id: session.session_id,
          condition_id: conditionId,
          fairness: session.survey.fairness,
          trust: session.survey.trust,
          cooperativeness: session.survey.cooperativeness,
          human_likeness: session.survey.human_likeness,
          satisfaction: session.survey.satisfaction,
          negotiate_again: session.survey.negotiate_again,
          comment: session.survey.comment ?? "",
        });
      }
    });

    const conditionOrder = ["neutral", "persona"];
    const orderedConditions = [
      ...conditionOrder.filter((key) => conditionCounts[key]),
      ...Object.keys(conditionCounts).filter((key) => !conditionOrder.includes(key)),
    ];

    const summaryRows = orderedConditions.map((conditionId) => ({
      condition_id: conditionId,
      sessions: conditionCounts[conditionId],
      agreement_rate: average(agreementRates[conditionId] ?? []),
      avg_joint_utility: average(jointUtilities[conditionId] ?? []),
      avg_efficiency: average(efficiencies[conditionId] ?? []),
      avg_fairness_index: average(fairnessIndexes[conditionId] ?? []),
      avg_nash_product: average(nashProducts[conditionId] ?? []),
      avg_nash_ratio: average(nashRatios[conditionId] ?? []),
      avg_nash_distance: average(nashDistances[conditionId] ?? []),
      pareto_efficiency_rate: average(paretoRates[conditionId] ?? []),
      avg_human_share: average(humanShares[conditionId] ?? []),
      avg_duration: average(durations[conditionId] ?? []),
      avg_turns: average(turnCounts[conditionId] ?? []),
      avg_response: average(responseLatencies[conditionId] ?? []),
      avg_human_concession: average(humanConcessions[conditionId] ?? []),
      avg_agent_concession: average(agentConcessions[conditionId] ?? []),
    }));

    const concessionCurveRows = Array.from(concessionCurveMap.values()).map((entry) => ({
      condition_id: entry.condition_id,
      persona_tag: entry.persona_tag,
      by: entry.by,
      turn: entry.turn,
      avg_concession: average(entry.concessions) ?? "",
      avg_cumulative_concession: average(entry.cumulative) ?? "",
      avg_own_utility: average(entry.own_utilities) ?? "",
      avg_opponent_utility: average(entry.opponent_utilities) ?? "",
      n: entry.concessions.length,
    }));

    const turnSet = new Set(concessionCurveRows.map((row) => row.turn).filter(Boolean));
    const turns = Array.from(turnSet).sort((a, b) => Number(a) - Number(b));
    const concessionLookup = new Map<string, (typeof concessionCurveRows)[number]>();
    concessionCurveRows.forEach((row) => {
      concessionLookup.set(`${row.condition_id}|${row.by}|${row.turn}`, row);
    });
    const plotRows = turns.map((turn) => {
      const neutralHuman = concessionLookup.get(`neutral|human|${turn}`);
      const neutralAgent = concessionLookup.get(`neutral|agent|${turn}`);
      const personaHuman = concessionLookup.get(`persona|human|${turn}`);
      const personaAgent = concessionLookup.get(`persona|agent|${turn}`);
      return {
        turn,
        neutral_human_concession: neutralHuman?.avg_concession ?? "",
        neutral_agent_concession: neutralAgent?.avg_concession ?? "",
        persona_human_concession: personaHuman?.avg_concession ?? "",
        persona_agent_concession: personaAgent?.avg_concession ?? "",
        neutral_human_utility: neutralHuman?.avg_own_utility ?? "",
        neutral_agent_utility: neutralAgent?.avg_own_utility ?? "",
        persona_human_utility: personaHuman?.avg_own_utility ?? "",
        persona_agent_utility: personaAgent?.avg_own_utility ?? "",
      };
    });

    const legendRows = [
      {
        metric: "Agreement Rate",
        definition: "Share of sessions ending in agreement.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = all sessions reached agreement.",
      },
      {
        metric: "Weighted Joint Utility",
        definition: "Human + agent weighted utility at agreement.",
        range: ">= 0",
        direction: "Higher is better",
        notes: "Depends on issue weights.",
      },
      {
        metric: "Efficiency",
        definition: "Joint utility / maximum possible joint utility.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = maximal joint outcome.",
      },
      {
        metric: "Fairness Index",
        definition: "1 - |human - agent| / joint utility.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = perfectly balanced utilities.",
      },
      {
        metric: "Nash Product",
        definition: "Human utility * agent utility at agreement.",
        range: ">= 0",
        direction: "Higher is better",
        notes: "Sensitive to both parties' gains.",
      },
      {
        metric: "Nash Ratio",
        definition: "Nash product / maximum Nash product.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = Nash-optimal outcome.",
      },
      {
        metric: "Nash Distance",
        definition: "Distance to the Nash point in utility space.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "0 = Nash-optimal outcome.",
      },
      {
        metric: "Pareto Efficiency Rate",
        definition: "Share of agreements on the Pareto frontier.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = all agreements Pareto efficient.",
      },
      {
        metric: "Human Share",
        definition: "Human utility / joint utility.",
        range: "0-1",
        direction: "Context dependent",
        notes: "Higher = more for human; not always better.",
      },
      {
        metric: "Offer Response (s)",
        definition: "Time from human offer to agent response.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Proxy for system responsiveness.",
      },
      {
        metric: "Concession",
        definition: "Drop in own utility from previous offer.",
        range: "Any",
        direction: "Context dependent",
        notes: "Higher = more concession in that turn.",
      },
      {
        metric: "Cumulative Concession",
        definition: "Sum of concessions over the session.",
        range: "Any",
        direction: "Context dependent",
        notes: "Higher = larger total concession.",
      },
    ];

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      file_count: files.length,
      summary: summaryRows,
      sessions: sessionRows,
      offers: offerRows,
      chats: chatRows,
      survey: surveyRows,
      concessions: concessionRows,
      concession_curves: concessionCurveRows,
      plots: plotRows,
      legend: legendRows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

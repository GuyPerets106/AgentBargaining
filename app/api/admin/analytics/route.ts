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
  frontier: AllocationPoint[];
  frontierSet: Set<string>;
  nash: { best: AllocationPoint | null; bestValue: number };
  maxJoint: number | null;
  maxHuman: number | null;
  maxAgent: number | null;
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

function computeParetoDistance(
  utilities: { human: number; agent: number },
  frontier: AllocationPoint[]
) {
  if (!frontier.length) return null;
  let min = Infinity;
  frontier.forEach((point) => {
    const distance = Math.sqrt(
      (utilities.human - point.utilities.human) ** 2 +
        (utilities.agent - point.utilities.agent) ** 2
    );
    if (distance < min) {
      min = distance;
    }
  });
  return Number.isFinite(min) ? min : null;
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
  const maxHuman = allocations.reduce(
    (max, point) => Math.max(max, point.utilities.human),
    0
  );
  const maxAgent = allocations.reduce(
    (max, point) => Math.max(max, point.utilities.agent),
    0
  );
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
  const stats = { allocations, frontier, frontierSet, nash, maxJoint, maxHuman, maxAgent };
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

type MetricBucket = Record<string, number[]>;
type MetricBuckets = {
  agreement_rate: MetricBucket;
  avg_joint_utility: MetricBucket;
  avg_efficiency: MetricBucket;
  avg_fairness_index: MetricBucket;
  avg_nash_product: MetricBucket;
  avg_nash_ratio: MetricBucket;
  avg_nash_distance: MetricBucket;
  avg_pareto_distance: MetricBucket;
  pareto_efficiency_rate: MetricBucket;
  avg_human_share: MetricBucket;
  avg_human_utility_ratio: MetricBucket;
  avg_agent_utility_ratio: MetricBucket;
  avg_ks_gap: MetricBucket;
  avg_acceptor_ratio: MetricBucket;
  avg_offer_nash_distance: MetricBucket;
  avg_offer_pareto_distance: MetricBucket;
  avg_duration: MetricBucket;
  avg_turns: MetricBucket;
  avg_response: MetricBucket;
  avg_human_concession: MetricBucket;
  avg_agent_concession: MetricBucket;
  avg_burstiness: MetricBucket;
  avg_cri: MetricBucket;
};

function createMetricBuckets(): MetricBuckets {
  return {
    agreement_rate: {},
    avg_joint_utility: {},
    avg_efficiency: {},
    avg_fairness_index: {},
    avg_nash_product: {},
    avg_nash_ratio: {},
    avg_nash_distance: {},
    avg_pareto_distance: {},
    pareto_efficiency_rate: {},
    avg_human_share: {},
    avg_human_utility_ratio: {},
    avg_agent_utility_ratio: {},
    avg_ks_gap: {},
    avg_acceptor_ratio: {},
    avg_offer_nash_distance: {},
    avg_offer_pareto_distance: {},
    avg_duration: {},
    avg_turns: {},
    avg_response: {},
    avg_human_concession: {},
    avg_agent_concession: {},
    avg_burstiness: {},
    avg_cri: {},
  };
}

function pushMetric(bucket: MetricBucket, key: string, value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  bucket[key] = bucket[key] || [];
  bucket[key].push(value);
}

function computeBurstiness(chats: Array<{ t: string }>) {
  const times = chats
    .map((chat) => Date.parse(chat.t))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  const intervals = times.slice(1).map((time, idx) => (time - times[idx]) / 1000);
  if (intervals.length === 0) return null;
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  if (mean === 0) return null;
  const variance =
    intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length;
  const std = Math.sqrt(variance);
  const denom = std + mean;
  if (denom === 0) return null;
  return (std - mean) / denom;
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
    const personaCounts: Record<string, number> = {};
    const overallKey = "overall";
    const overallCounts: Record<string, number> = { [overallKey]: 0 };
    const conditionMetrics = createMetricBuckets();
    const personaMetrics = createMetricBuckets();
    const overallMetrics = createMetricBuckets();
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
      const personaKey =
        personaTag || (conditionId === "neutral" ? "neutral" : "unspecified");

      conditionCounts[conditionId] = (conditionCounts[conditionId] ?? 0) + 1;
      personaCounts[personaKey] = (personaCounts[personaKey] ?? 0) + 1;
      overallCounts[overallKey] = (overallCounts[overallKey] ?? 0) + 1;

      const pushAll = (metric: keyof MetricBuckets, value: number | null) => {
        pushMetric(conditionMetrics[metric], conditionId, value);
        pushMetric(personaMetrics[metric], personaKey, value);
        pushMetric(overallMetrics[metric], overallKey, value);
      };

      const agreement = outcome.reason === "agreement";
      const agreedAllocation = outcome.agreed_offer?.allocation ?? null;
      const utilities = agreedAllocation
        ? computeWeightedUtility(agreedAllocation, weights)
        : { human: null, agent: null, joint: null };

      const maxHuman = allocationStats?.maxHuman ?? null;
      const maxAgent = allocationStats?.maxAgent ?? null;
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
      const paretoDistance =
        allocationStats && utilities.human !== null && utilities.agent !== null
          ? computeParetoDistance(
              { human: utilities.human, agent: utilities.agent },
              allocationStats.frontier
            )
          : null;
      const paretoEfficient =
        allocationStats && utilities.human !== null && utilities.agent !== null
          ? allocationStats.frontierSet.has(`${utilities.human}|${utilities.agent}`)
          : null;
      const humanShare =
        utilities.joint && utilities.human !== null ? utilities.human / utilities.joint : null;
      const humanRatio =
        utilities.human !== null && maxHuman ? utilities.human / maxHuman : null;
      const agentRatio =
        utilities.agent !== null && maxAgent ? utilities.agent / maxAgent : null;
      const ksGap =
        humanRatio !== null && agentRatio !== null
          ? Math.abs(humanRatio - agentRatio)
          : null;

      const acceptEvent = [...events].reverse().find((event) => event.type === "offer_accept");
      const acceptBy = (acceptEvent?.payload as { by?: string } | undefined)?.by ?? "";
      const acceptorRatio =
        acceptBy === "human" ? humanRatio : acceptBy === "agent" ? agentRatio : null;

      pushAll("agreement_rate", agreement ? 1 : 0);
      pushAll("avg_joint_utility", utilities.joint ?? null);
      pushAll("avg_efficiency", efficiency);
      pushAll("avg_fairness_index", fairnessIndex);
      pushAll("avg_nash_product", nashProduct);
      pushAll("avg_nash_ratio", nashRatio);
      pushAll("avg_nash_distance", nashDistance);
      pushAll("avg_pareto_distance", paretoDistance);
      pushAll(
        "pareto_efficiency_rate",
        paretoEfficient === null ? null : paretoEfficient ? 1 : 0
      );
      pushAll("avg_human_share", humanShare);
      pushAll("avg_human_utility_ratio", humanRatio);
      pushAll("avg_agent_utility_ratio", agentRatio);
      pushAll("avg_ks_gap", ksGap);
      pushAll("avg_acceptor_ratio", acceptorRatio);
      pushAll(
        "avg_duration",
        typeof outcome.duration_seconds === "number" ? outcome.duration_seconds : null
      );
      pushAll("avg_turns", typeof outcome.turns === "number" ? outcome.turns : null);

      const latencies = computeOfferLatencies(offers);
      const avgResponse = average(latencies);
      latencies.forEach((latency) => pushAll("avg_response", latency));

      const concessions = computeConcessions(offers, weights);
      const concessionTotals = { human: 0, agent: 0 };
      concessions.forEach((row) => {
        const enriched = {
          session_id: session.session_id,
          condition_id: conditionId,
          persona_tag: personaTag,
          ...row,
        };
        concessionRows.push(enriched);
        if (row.concession === null || typeof row.concession !== "number") return;
        const positiveConcession = row.concession > 0 ? row.concession : 0;
        if (row.by === "human") {
          pushAll("avg_human_concession", row.concession);
          concessionTotals.human += positiveConcession;
        } else if (row.by === "agent") {
          pushAll("avg_agent_concession", row.concession);
          concessionTotals.agent += positiveConcession;
        }
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

      const criDenominator = concessionTotals.human + concessionTotals.agent;
      const cri =
        criDenominator > 0
          ? (concessionTotals.agent - concessionTotals.human) / criDenominator
          : null;
      pushAll("avg_cri", cri);

      const burstiness = computeBurstiness(chats);
      pushAll("avg_burstiness", burstiness);

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
        max_human_utility: maxHuman ?? "",
        max_agent_utility: maxAgent ?? "",
        human_utility_ratio: humanRatio ?? "",
        agent_utility_ratio: agentRatio ?? "",
        ks_gap: ksGap ?? "",
        fairness_index: fairnessIndex ?? "",
        efficiency: efficiency ?? "",
        max_joint_utility: maxJoint ?? "",
        nash_product: nashProduct ?? "",
        nash_ratio: nashRatio ?? "",
        nash_distance: nashDistance ?? "",
        pareto_distance: paretoDistance ?? "",
        pareto_efficient:
          paretoEfficient === null ? "" : paretoEfficient ? "yes" : "no",
        human_share: humanShare ?? "",
        acceptor: acceptBy,
        acceptor_ratio: acceptorRatio ?? "",
        avg_response: avgResponse ?? "",
        burstiness: burstiness ?? "",
        cri: cri ?? "",
        file: filename,
      });

      if (allocationStats) {
        const offerNashDistancesForSession: number[] = [];
        const offerParetoDistancesForSession: number[] = [];
        offers.forEach((offer) => {
          const offerUtilities = computeWeightedUtility(offer.allocation, weights);
          if (allocationStats.nash.best?.utilities) {
            const distance = Math.sqrt(
              (offerUtilities.human - allocationStats.nash.best.utilities.human) ** 2 +
                (offerUtilities.agent - allocationStats.nash.best.utilities.agent) ** 2
            );
            offerNashDistancesForSession.push(distance);
          }
          const distanceToPareto = computeParetoDistance(
            { human: offerUtilities.human, agent: offerUtilities.agent },
            allocationStats.frontier
          );
          if (distanceToPareto !== null) {
            offerParetoDistancesForSession.push(distanceToPareto);
          }
        });
        const avgOfferNash = average(offerNashDistancesForSession);
        const avgOfferPareto = average(offerParetoDistancesForSession);
        pushAll("avg_offer_nash_distance", avgOfferNash);
        pushAll("avg_offer_pareto_distance", avgOfferPareto);
        const lastSessionRow = sessionRows[sessionRows.length - 1];
        lastSessionRow.avg_offer_nash_distance = avgOfferNash ?? "";
        lastSessionRow.avg_offer_pareto_distance = avgOfferPareto ?? "";
      }

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

    const buildSummaryRow = (
      key: string,
      counts: Record<string, number>,
      buckets: MetricBuckets
    ) => ({
      sessions: counts[key] ?? 0,
      agreement_rate: average(buckets.agreement_rate[key] ?? []),
      avg_joint_utility: average(buckets.avg_joint_utility[key] ?? []),
      avg_efficiency: average(buckets.avg_efficiency[key] ?? []),
      avg_fairness_index: average(buckets.avg_fairness_index[key] ?? []),
      avg_nash_product: average(buckets.avg_nash_product[key] ?? []),
      avg_nash_ratio: average(buckets.avg_nash_ratio[key] ?? []),
      avg_nash_distance: average(buckets.avg_nash_distance[key] ?? []),
      avg_pareto_distance: average(buckets.avg_pareto_distance[key] ?? []),
      pareto_efficiency_rate: average(buckets.pareto_efficiency_rate[key] ?? []),
      avg_human_share: average(buckets.avg_human_share[key] ?? []),
      avg_human_utility_ratio: average(buckets.avg_human_utility_ratio[key] ?? []),
      avg_agent_utility_ratio: average(buckets.avg_agent_utility_ratio[key] ?? []),
      avg_ks_gap: average(buckets.avg_ks_gap[key] ?? []),
      avg_acceptor_ratio: average(buckets.avg_acceptor_ratio[key] ?? []),
      avg_offer_nash_distance: average(buckets.avg_offer_nash_distance[key] ?? []),
      avg_offer_pareto_distance: average(buckets.avg_offer_pareto_distance[key] ?? []),
      avg_duration: average(buckets.avg_duration[key] ?? []),
      avg_turns: average(buckets.avg_turns[key] ?? []),
      avg_response: average(buckets.avg_response[key] ?? []),
      avg_human_concession: average(buckets.avg_human_concession[key] ?? []),
      avg_agent_concession: average(buckets.avg_agent_concession[key] ?? []),
      avg_burstiness: average(buckets.avg_burstiness[key] ?? []),
      avg_cri: average(buckets.avg_cri[key] ?? []),
    });

    const summaryRows = orderedConditions.map((conditionId) => ({
      condition_id: conditionId,
      ...buildSummaryRow(conditionId, conditionCounts, conditionMetrics),
    }));

    const orderedPersonas = Object.keys(personaCounts).sort((a, b) => a.localeCompare(b));
    const summaryPersonas = orderedPersonas.map((personaTag) => ({
      persona_tag: personaTag,
      ...buildSummaryRow(personaTag, personaCounts, personaMetrics),
    }));

    const summaryOverall = overallCounts[overallKey]
      ? [
          {
            label: overallKey,
            ...buildSummaryRow(overallKey, overallCounts, overallMetrics),
          },
        ]
      : [];

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
        metric: "Sessions",
        definition: "Total number of sessions in the group.",
        range: ">= 0",
        direction: "Context dependent",
        notes: "Higher means more data for that segment.",
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
        metric: "Human Utility Ratio",
        definition: "Human utility / maximum feasible human utility.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = human reaches their utopia payoff.",
      },
      {
        metric: "Agent Utility Ratio",
        definition: "Agent utility / maximum feasible agent utility.",
        range: "0-1",
        direction: "Higher is better",
        notes: "1 = agent reaches their utopia payoff.",
      },
      {
        metric: "KS Gap",
        definition: "Absolute gap between human and agent utility ratios.",
        range: "0-1",
        direction: "Lower is better",
        notes: "0 = proportional (Kalai-Smorodinsky aligned).",
      },
      {
        metric: "Pareto Distance",
        definition: "Distance from agreement utility to Pareto frontier.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "0 = Pareto efficient.",
      },
      {
        metric: "Acceptor Ratio",
        definition: "Utility ratio for the accepting side.",
        range: "0-1",
        direction: "Higher is better",
        notes: "Proxy for acceptance threshold.",
      },
      {
        metric: "Avg Offer Nash Distance",
        definition: "Average distance of offers to the Nash point.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Lower = offers closer to Nash-optimal region.",
      },
      {
        metric: "Avg Offer Pareto Distance",
        definition: "Average distance of offers to the Pareto frontier.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Lower = offers closer to efficiency frontier.",
      },
      {
        metric: "Average Duration",
        definition: "Average seconds from negotiation start to end.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Shorter sessions may reflect faster convergence.",
      },
      {
        metric: "Average Turns",
        definition: "Average number of turns until end.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Lower turns indicates faster agreement or termination.",
      },
      {
        metric: "Average Human Concession",
        definition: "Average drop in human utility between their offers.",
        range: "Any",
        direction: "Context dependent",
        notes: "Higher = larger concessions per turn.",
      },
      {
        metric: "Average Agent Concession",
        definition: "Average drop in agent utility between their offers.",
        range: "Any",
        direction: "Context dependent",
        notes: "Higher = larger concessions per turn.",
      },
      {
        metric: "Concession Curve: Neutral Human",
        definition:
          "Average per-turn concession for humans in sessions where the agent uses neutral language.",
        range: "Any",
        direction: "Context dependent",
        notes: "Tracks how humans conceded under neutral-agent wording.",
      },
      {
        metric: "Concession Curve: Neutral Agent",
        definition:
          "Average per-turn concession for agents in sessions where the agent uses neutral language.",
        range: "Any",
        direction: "Context dependent",
        notes: "Tracks agent concessions under neutral wording.",
      },
      {
        metric: "Concession Curve: Persona Human",
        definition:
          "Average per-turn concession for humans in sessions where the agent uses a persona.",
        range: "Any",
        direction: "Context dependent",
        notes: "Tracks how humans conceded under persona-agent wording.",
      },
      {
        metric: "Concession Curve: Persona Agent",
        definition:
          "Average per-turn concession for agents in sessions where the agent uses a persona.",
        range: "Any",
        direction: "Context dependent",
        notes: "Tracks agent concessions under persona wording.",
      },
      {
        metric: "Offer Response (s)",
        definition: "Time from human offer to agent response.",
        range: ">= 0",
        direction: "Lower is better",
        notes: "Proxy for system responsiveness.",
      },
      {
        metric: "Burstiness",
        definition: "Inter-message timing variability: (σ - μ)/(σ + μ).",
        range: "-1 to 1",
        direction: "Context dependent",
        notes: "Higher = more bursty bursts of messaging.",
      },
      {
        metric: "CRI (Concession Reciprocity Index)",
        definition: "Relative concession balance: (agent - human) / (agent + human).",
        range: "-1 to 1",
        direction: "Context dependent",
        notes: "IAGO-style reciprocity: positive = agent conceded more.",
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
      summary_personas: summaryPersonas,
      summary_overall: summaryOverall,
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

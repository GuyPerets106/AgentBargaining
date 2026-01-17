import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const DEFAULT_INPUT = "data";
const DEFAULT_OUTPUT = "reports/negotiation-report.xlsx";
const DEFAULT_WEIGHTS_PATH = "lib/weights.json";
const COLORS = {
  headerBg: "FF1F4B99",
  headerText: "FFFFFFFF",
  zebra: "FFF7F9FC",
  neutralFill: "FFE2E8F0",
  personaFill: "FFDBEAFE",
  neutralText: "FF0F172A",
  personaText: "FF1D4ED8",
  positive: "FF15803D",
  negative: "FFB91C1C",
  caution: "FFB45309",
};
const ALLOCATION_SAMPLE_THRESHOLD = 500000;
const FAIR_SAMPLE_SIZE = 20000;
const BOOTSTRAP_ITERATIONS = 2000;
const BOOTSTRAP_SEED = 1337;
const EPS_DELTA = 1e-6;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { input: DEFAULT_INPUT, out: DEFAULT_OUTPUT, weights: DEFAULT_WEIGHTS_PATH };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") {
      parsed.input = args[i + 1];
      i += 1;
    } else if (arg === "--out") {
      parsed.out = args[i + 1];
      i += 1;
    } else if (arg === "--weights") {
      parsed.weights = args[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function listSessionFiles(inputPath) {
  const fullPath = path.resolve(inputPath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return [fullPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(fullPath)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(fullPath, name));
}

function computeWeightedUtility(allocation, weights) {
  let human = 0;
  let agent = 0;
  Object.entries(allocation || {}).forEach(([issue, split]) => {
    const humanWeight = weights.human[issue] ?? 1;
    const agentWeight = weights.agent[issue] ?? 1;
    human += (split?.human ?? 0) * humanWeight;
    agent += (split?.agent ?? 0) * agentWeight;
  });
  return { human, agent, joint: human + agent };
}

function computeMaxJointUtility(config, weights) {
  if (!config?.issues) return null;
  return config.issues.reduce((sum, issue) => {
    const humanWeight = weights.human[issue.key] ?? 1;
    const agentWeight = weights.agent[issue.key] ?? 1;
    return sum + issue.total * Math.max(humanWeight, agentWeight);
  }, 0);
}

function createRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function allocationSpaceSize(issues) {
  if (!issues?.length) return 0;
  let product = 1;
  for (const issue of issues) {
    product *= issue.total + 1;
    if (product > ALLOCATION_SAMPLE_THRESHOLD) return product;
  }
  return product;
}

function sampleAllocations(issues, sampleSize, rng) {
  const samples = [];
  if (!issues?.length || sampleSize <= 0) return samples;
  for (let i = 0; i < sampleSize; i += 1) {
    const allocation = {};
    issues.forEach((issue) => {
      const draw = Math.floor(rng() * (issue.total + 1));
      allocation[issue.key] = { human: draw, agent: issue.total - draw };
    });
    samples.push(allocation);
  }
  return samples;
}

function generateAllocations(issues) {
  const results = [];

  const recurse = (index, current) => {
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

function computeParetoFrontier(points) {
  const sorted = [...points].sort((a, b) => {
    if (b.utilities.human !== a.utilities.human) {
      return b.utilities.human - a.utilities.human;
    }
    return b.utilities.agent - a.utilities.agent;
  });
  const frontier = [];
  let maxAgent = -Infinity;
  for (const point of sorted) {
    if (point.utilities.agent > maxAgent) {
      frontier.push(point);
      maxAgent = point.utilities.agent;
    }
  }
  return frontier;
}

function computeNashPoint(points) {
  let best = null;
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

function computeFairPoint(points) {
  let best = null;
  let bestGap = Infinity;
  let bestJoint = -Infinity;
  for (const point of points) {
    const gap = Math.abs(point.utilities.human - point.utilities.agent);
    if (gap < bestGap || (gap === bestGap && point.utilities.joint > bestJoint)) {
      best = point;
      bestGap = gap;
      bestJoint = point.utilities.joint;
    }
  }
  return best;
}

const allocationCache = new Map();

function getAllocationStats(issues, weights) {
  const key = JSON.stringify(issues.map((issue) => ({ key: issue.key, total: issue.total })));
  if (allocationCache.has(key)) {
    return allocationCache.get(key);
  }

  const spaceSize = allocationSpaceSize(issues);
  const shouldSample = spaceSize > ALLOCATION_SAMPLE_THRESHOLD;
  const rng = createRng(BOOTSTRAP_SEED);
  const rawAllocations = shouldSample
    ? sampleAllocations(issues, FAIR_SAMPLE_SIZE, rng)
    : generateAllocations(issues);
  const allocations = rawAllocations.map((allocation) => ({
    allocation,
    utilities: computeWeightedUtility(allocation, weights),
  }));

  const frontier = computeParetoFrontier(allocations);
  const frontierSet = new Set(
    frontier.map((point) => `${point.utilities.human}|${point.utilities.agent}`)
  );
  const nash = computeNashPoint(allocations);
  const fair = computeFairPoint(allocations);
  const maxJoint = computeMaxJointUtility({ issues }, weights);

  const stats = {
    allocations,
    frontierSet,
    nash,
    fair,
    maxJoint,
    sampled: shouldSample,
    spaceSize,
  };
  allocationCache.set(key, stats);
  return stats;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getEvents(session) {
  return Array.isArray(session.events) ? session.events : [];
}

function collectOffers(events) {
  return events
    .filter((event) => event.type === "offer_propose" || event.type === "offer_receive")
    .map((event) => ({
      ...event.payload.offer,
      by: event.payload.offer?.by ?? (event.type === "offer_propose" ? "human" : "agent"),
      t: event.t,
    }))
    .filter((offer) => offer && offer.allocation);
}

function collectChats(events) {
  return events
    .filter((event) => event.type === "chat_send" || event.type === "chat_receive")
    .map((event) => ({
      role: event.type === "chat_send" ? "human" : "agent",
      t: event.t,
      content: event.payload?.content ?? "",
    }));
}

function computeOfferLatencies(offers) {
  const pairs = [];
  const byTurn = new Map();
  offers.forEach((offer) => {
    const key = `${offer.turn}-${offer.by}`;
    byTurn.set(key, offer);
  });
  offers
    .filter((offer) => offer.by === "human")
    .forEach((offer) => {
      const agentOffer = byTurn.get(`${offer.turn + 1}-agent`);
      if (agentOffer?.created_at && offer.created_at) {
        const latency = (Date.parse(agentOffer.created_at) - Date.parse(offer.created_at)) / 1000;
        if (!Number.isNaN(latency)) {
          pairs.push(latency);
        }
      }
    });
  return pairs;
}

function getOfferTime(offer) {
  const stamp = offer.created_at ?? offer.t ?? "";
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortOffers(offers) {
  return [...offers].sort((a, b) => {
    const turnDiff = (a.turn ?? 0) - (b.turn ?? 0);
    if (turnDiff !== 0) return turnDiff;
    return getOfferTime(a) - getOfferTime(b);
  });
}

function computeConcessions(offers, weights, issues) {
  const byRole = { human: [], agent: [] };
  sortOffers(offers).forEach((offer) => {
    if (!offer?.allocation || !offer?.by) return;
    const utilities = computeWeightedUtility(offer.allocation, weights);
    const own = offer.by === "human" ? utilities.human : utilities.agent;
    const opponent = offer.by === "human" ? utilities.agent : utilities.human;
    byRole[offer.by].push({
      turn: offer.turn ?? "",
      created_at: offer.created_at ?? offer.t ?? "",
      own_utility: own,
      opponent_utility: opponent,
      joint_utility: utilities.joint,
      allocation_key: buildAllocationKey(offer.allocation, issues),
    });
  });

  const rows = [];
  Object.entries(byRole).forEach(([by, roleOffers]) => {
    let previousOwn = null;
    let previousAllocationKey = null;
    let cumulative = 0;
    roleOffers.forEach((offer) => {
      let concession = null;
      if (previousOwn !== null) {
        concession = previousOwn - offer.own_utility;
        cumulative += concession;
      }
      const concessionPos =
        concession === null ? null : Math.max(concession, 0);
      const toughen =
        concession === null ? null : Math.max(-concession, 0);
      const absMove = concession === null ? null : Math.abs(concession);
      const isRepeatOffer =
        previousAllocationKey !== null && offer.allocation_key === previousAllocationKey;
      rows.push({
        by,
        turn: offer.turn,
        created_at: offer.created_at,
        own_utility: offer.own_utility,
        opponent_utility: offer.opponent_utility,
        joint_utility: offer.joint_utility,
        concession,
        concession_pos: concessionPos,
        toughen,
        abs_move: absMove,
        is_repeat_offer: previousOwn === null ? null : isRepeatOffer,
        cumulative_concession: previousOwn === null ? null : cumulative,
        own_share:
          offer.joint_utility ? offer.own_utility / offer.joint_utility : null,
      });
      previousOwn = offer.own_utility;
      previousAllocationKey = offer.allocation_key;
    });
  });
  return rows;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function bootstrapCI(values, iterations = BOOTSTRAP_ITERATIONS, seed = BOOTSTRAP_SEED) {
  const clean = values.filter((val) => typeof val === "number" && !Number.isNaN(val));
  const n = clean.length;
  if (n === 0) {
    return { mean: null, std: null, ci_low: null, ci_high: null };
  }
  const mean = average(clean);
  const std = standardDeviation(clean);
  const rng = createRng(seed);
  const means = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) {
      const idx = Math.floor(rng() * n);
      sum += clean[idx];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * (means.length - 1));
  const highIdx = Math.floor(0.975 * (means.length - 1));
  return {
    mean,
    std,
    ci_low: means[lowIdx],
    ci_high: means[highIdx],
  };
}

function bootstrapDiffCI(valuesA, valuesB, iterations = BOOTSTRAP_ITERATIONS, seed = BOOTSTRAP_SEED) {
  const cleanA = valuesA.filter((val) => typeof val === "number" && !Number.isNaN(val));
  const cleanB = valuesB.filter((val) => typeof val === "number" && !Number.isNaN(val));
  if (!cleanA.length || !cleanB.length) {
    return { ci_low: null, ci_high: null };
  }
  const rng = createRng(seed + 11);
  const nA = cleanA.length;
  const nB = cleanB.length;
  const diffs = [];
  for (let i = 0; i < iterations; i += 1) {
    let sumA = 0;
    let sumB = 0;
    for (let j = 0; j < nA; j += 1) {
      sumA += cleanA[Math.floor(rng() * nA)];
    }
    for (let j = 0; j < nB; j += 1) {
      sumB += cleanB[Math.floor(rng() * nB)];
    }
    diffs.push(sumA / nA - sumB / nB);
  }
  diffs.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * (diffs.length - 1));
  const highIdx = Math.floor(0.975 * (diffs.length - 1));
  return {
    ci_low: diffs[lowIdx],
    ci_high: diffs[highIdx],
  };
}

function cohensD(valuesA, valuesB) {
  const cleanA = valuesA.filter((val) => typeof val === "number" && !Number.isNaN(val));
  const cleanB = valuesB.filter((val) => typeof val === "number" && !Number.isNaN(val));
  if (!cleanA.length || !cleanB.length) return null;
  const meanA = average(cleanA);
  const meanB = average(cleanB);
  const varA = standardDeviation(cleanA) ** 2;
  const varB = standardDeviation(cleanB) ** 2;
  const pooled =
    cleanA.length + cleanB.length - 2 > 0
      ? Math.sqrt(
          ((cleanA.length - 1) * varA + (cleanB.length - 1) * varB) /
            (cleanA.length + cleanB.length - 2)
        )
      : 0;
  if (!pooled) return 0;
  return (meanA - meanB) / pooled;
}

function buildAllocationKey(allocation, issues) {
  if (!issues?.length) return "";
  return issues
    .map((issue) => {
      const split = allocation?.[issue.key] ?? { human: 0, agent: 0 };
      return `${issue.key}:${split.human}-${split.agent}`;
    })
    .join("|");
}

function computeAnchors(offers, weights, issues, allocationStats, sessionId) {
  const sorted = sortOffers(offers);
  const firstHuman = sorted.find((offer) => offer.by === "human");
  const firstAgent = sorted.find((offer) => offer.by === "agent");
  if (!firstHuman) {
    console.warn(`[warn] session ${sessionId}: no human offer found for anchors.`);
  }
  if (!firstAgent) {
    console.warn(`[warn] session ${sessionId}: no agent offer found for anchors.`);
  }

  const nashUtilities = allocationStats?.nash?.best?.utilities ?? null;
  const fairUtilities = allocationStats?.fair?.utilities ?? null;
  if (!nashUtilities || !fairUtilities) {
    console.warn(`[warn] session ${sessionId}: missing Nash/Fair utilities for anchors.`);
  }

  const computeForRole = (role, offer) => {
    if (!offer?.allocation) {
      return {
        anchor_own_u: null,
        anchor_opp_u: null,
        anchor_share: null,
        dist_nash_L1: null,
        dist_fair_L1: null,
      };
    }
    const utilities = computeWeightedUtility(offer.allocation, weights);
    const own = role === "human" ? utilities.human : utilities.agent;
    const opp = role === "human" ? utilities.agent : utilities.human;
    const share = (own ?? 0) / ((own ?? 0) + (opp ?? 0) + 1e-9);
    const distNash =
      nashUtilities && utilities.human !== null && utilities.agent !== null
        ? Math.abs(utilities.human - nashUtilities.human) +
          Math.abs(utilities.agent - nashUtilities.agent)
        : null;
    const distFair =
      fairUtilities && utilities.human !== null && utilities.agent !== null
        ? Math.abs(utilities.human - fairUtilities.human) +
          Math.abs(utilities.agent - fairUtilities.agent)
        : null;
    return {
      anchor_own_u: own,
      anchor_opp_u: opp,
      anchor_share: share,
      dist_nash_L1: distNash,
      dist_fair_L1: distFair,
    };
  };

  return {
    human: computeForRole("human", firstHuman),
    agent: computeForRole("agent", firstAgent),
  };
}

function computeConcessionShapeMetrics(offers, weights, issues, epsDelta = EPS_DELTA) {
  const sorted = sortOffers(offers);
  const roleData = { human: [], agent: [] };

  sorted.forEach((offer) => {
    if (!offer?.allocation || !offer?.by) return;
    const utilities = computeWeightedUtility(offer.allocation, weights);
    const own = offer.by === "human" ? utilities.human : utilities.agent;
    roleData[offer.by].push({
      own,
      allocationKey: buildAllocationKey(offer.allocation, issues),
    });
  });

  const computeRoleMetrics = (roleOffers) => {
    const deltas = [];
    const absMoves = [];
    let concedeSum = 0;
    let toughenSum = 0;
    let concedeCount = 0;
    let toughenCount = 0;
    let flatCount = 0;
    let repeatCount = 0;
    for (let i = 1; i < roleOffers.length; i += 1) {
      const delta = roleOffers[i - 1].own - roleOffers[i].own;
      deltas.push(delta);
      const absMove = Math.abs(delta);
      absMoves.push(absMove);
      if (delta > epsDelta) {
        concedeSum += delta;
        concedeCount += 1;
      } else if (delta < -epsDelta) {
        toughenSum += Math.abs(delta);
        toughenCount += 1;
      } else {
        flatCount += 1;
      }
      if (roleOffers[i - 1].allocationKey === roleOffers[i].allocationKey) {
        repeatCount += 1;
      }
    }

    const denom = Math.max(1, deltas.length);
    const totalAbs = absMoves.reduce((sum, val) => sum + val, 0);
    const meanAbs = absMoves.length ? average(absMoves) : 0;
    const burstiness =
      absMoves.length > 0 ? Math.max(...absMoves) / (meanAbs + 1e-9) : 0;
    const endload2 =
      absMoves.length > 0
        ? absMoves.slice(-2).reduce((sum, val) => sum + val, 0) / (totalAbs + 1e-9)
        : 0;
    const endload3 =
      absMoves.length > 2
        ? absMoves.slice(-3).reduce((sum, val) => sum + val, 0) / (totalAbs + 1e-9)
        : null;

    return {
      concede_sum: concedeSum,
      toughen_sum: toughenSum,
      concede_rate: concedeCount / denom,
      toughen_rate: toughenCount / denom,
      rigidity_flat_rate: flatCount / denom,
      burstiness,
      endload2,
      endload3,
      repeat_offer_rate: repeatCount / denom,
    };
  };

  return {
    human: computeRoleMetrics(roleData.human),
    agent: computeRoleMetrics(roleData.agent),
  };
}

function pushMetricValue(store, group, key, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  store[group] = store[group] || {};
  store[group][key] = store[group][key] || [];
  store[group][key].push(value);
}

function columnLetter(index) {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result || "A";
}

function setAutoFilter(worksheet) {
  if (!worksheet.columns?.length) return;
  const lastCol = columnLetter(worksheet.columns.length);
  worksheet.autoFilter = { from: "A1", to: `${lastCol}1` };
}

function applySheetLayout(worksheet, options = {}) {
  const { freezeHeader = true } = options;
  worksheet.properties.defaultRowHeight = 18;
  if (freezeHeader) {
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
  }
}

function applyAlignment(worksheet, options = {}) {
  const { wrapColumns = [] } = options;
  worksheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 22 : 18;
    row.eachCell((cell) => {
      const wrap = wrapColumns.includes(cell._column?.key);
      cell.alignment = {
        vertical: "middle",
        horizontal: rowNumber === 1 ? "center" : "left",
        wrapText: wrap,
      };
    });
  });
}

function formatColumns(worksheet, formatMap) {
  Object.entries(formatMap).forEach(([key, config]) => {
    const column = worksheet.getColumn(key);
    if (!column) return;
    if (config.numFmt) {
      column.numFmt = config.numFmt;
    }
    if (config.alignment) {
      column.alignment = config.alignment;
    }
  });
}

function buildBar(value, maxValue, width = 18) {
  if (value === null || value === undefined || maxValue <= 0) return "";
  const scaled = Math.max(0, value);
  const filled = Math.min(width, Math.round((scaled / maxValue) * width));
  return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
}


function styleHeader(row) {
  row.font = { bold: true, color: { argb: COLORS.headerText }, size: 11 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.headerBg },
  };
  row.alignment = { vertical: "middle", horizontal: "center" };
}

function applyZebra(worksheet) {
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rowNumber % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
    }
  });
}

function autoWidth(worksheet) {
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? cell.value.toString() : "";
      maxLength = Math.max(maxLength, value.length + 2);
    });
    column.width = Math.min(maxLength, 40);
  });
}

async function main() {
  const { input, out, weights: weightsPath } = parseArgs();
  const sessionFiles = listSessionFiles(input);
  if (!sessionFiles.length) {
    console.error("No session JSON files found.");
    process.exit(1);
  }

  const weights = fs.existsSync(weightsPath)
    ? loadJson(weightsPath)
    : { human: {}, agent: {} };

  const sessions = sessionFiles.map((filePath) => {
    const session = loadJson(filePath);
    return { filePath, session };
  });

  const sessionRows = [];
  const offerRows = [];
  const chatRows = [];
  const surveyRows = [];

  const conditionCounts = {};
  const agreementRates = {};
  const jointUtilities = {};
  const fairnessIndexes = {};
  const efficiencies = {};
  const nashProducts = {};
  const nashRatios = {};
  const nashDistances = {};
  const paretoRates = {};
  const humanShares = {};
  const durations = {};
  const turnCounts = {};
  const responseLatencies = {};
  const humanConcessions = {};
  const agentConcessions = {};
  const concessionRows = [];
  const concessionCurveMap = new Map();
  const conditionMetricValues = {};
  const personaMetricValues = {};

  const recordMetric = (conditionId, personaTag, key, value) => {
    pushMetricValue(conditionMetricValues, conditionId, key, value);
    if (personaTag) {
      pushMetricValue(personaMetricValues, personaTag, key, value);
    }
  };

  for (const { filePath, session } of sessions) {
    try {
      const events = getEvents(session);
      const offers = collectOffers(events);
      const chats = collectChats(events);
      const outcome = session.outcome ?? {};
      const conditionId = session.condition?.id ?? "unknown";
      const personaTag = session.condition?.persona_tag ?? "";
      const issues = session.config?.issues ?? [];
      if (!offers.length) {
        console.warn(`[warn] session ${session.session_id}: no offers recorded.`);
      }
      const allocationStats = issues.length ? getAllocationStats(issues, weights) : null;
      const maxJoint = allocationStats?.maxJoint ?? computeMaxJointUtility(session.config, weights);
      if (allocationStats?.sampled) {
        console.warn(
          `[warn] session ${session.session_id}: allocation space ${allocationStats.spaceSize} sampled for metrics.`
        );
      }
  
      conditionCounts[conditionId] = (conditionCounts[conditionId] ?? 0) + 1;
  
    const agreement = outcome.reason === "agreement";
    const agreedAllocation = outcome.agreed_offer?.allocation ?? null;
    if (agreement && !agreedAllocation) {
      console.warn(
        `[warn] session ${session.session_id}: agreement outcome without agreed offer allocation.`
      );
    }
      const utilities = agreedAllocation
        ? computeWeightedUtility(agreedAllocation, weights)
        : { human: null, agent: null, joint: null };
      const fairnessIndex =
        utilities.joint && utilities.human !== null && utilities.agent !== null
          ? 1 - Math.abs(utilities.human - utilities.agent) / utilities.joint
          : null;
      const efficiency =
        maxJoint && utilities.joint ? utilities.joint / maxJoint : null;
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
    const anchors = computeAnchors(
      offers,
      weights,
      issues,
      allocationStats,
      session.session_id
    );
    const shapeMetrics = computeConcessionShapeMetrics(offers, weights, issues);

    recordMetric(conditionId, personaTag, "agreement_rate", agreement ? 1 : 0);
    recordMetric(
      conditionId,
      personaTag,
      "turns_to_agreement",
      agreement ? outcome.turns : null
    );
    recordMetric(conditionId, personaTag, "joint_utility", utilities.joint);
    recordMetric(conditionId, personaTag, "nash_product", nashProduct);
    recordMetric(
      conditionId,
      personaTag,
      "pareto_efficiency_gap",
      paretoEfficient === null ? null : paretoEfficient ? 0 : 1
    );
    recordMetric(conditionId, personaTag, "human_anchor_share", anchors.human.anchor_share);
    recordMetric(conditionId, personaTag, "agent_anchor_share", anchors.agent.anchor_share);
    recordMetric(conditionId, personaTag, "human_anchor_own_u", anchors.human.anchor_own_u);
    recordMetric(conditionId, personaTag, "agent_anchor_own_u", anchors.agent.anchor_own_u);
    recordMetric(
      conditionId,
      personaTag,
      "human_anchor_dist_nash_L1",
      anchors.human.dist_nash_L1
    );
    recordMetric(
      conditionId,
      personaTag,
      "agent_anchor_dist_nash_L1",
      anchors.agent.dist_nash_L1
    );
    recordMetric(
      conditionId,
      personaTag,
      "human_anchor_dist_fair_L1",
      anchors.human.dist_fair_L1
    );
    recordMetric(
      conditionId,
      personaTag,
      "agent_anchor_dist_fair_L1",
      anchors.agent.dist_fair_L1
    );
    recordMetric(conditionId, personaTag, "human_burstiness", shapeMetrics.human.burstiness);
    recordMetric(conditionId, personaTag, "agent_burstiness", shapeMetrics.agent.burstiness);
    recordMetric(
      conditionId,
      personaTag,
      "human_rigidity_flat_rate",
      shapeMetrics.human.rigidity_flat_rate
    );
    recordMetric(
      conditionId,
      personaTag,
      "agent_rigidity_flat_rate",
      shapeMetrics.agent.rigidity_flat_rate
    );
    recordMetric(conditionId, personaTag, "human_endload2", shapeMetrics.human.endload2);
    recordMetric(conditionId, personaTag, "agent_endload2", shapeMetrics.agent.endload2);
    recordMetric(conditionId, personaTag, "human_endload3", shapeMetrics.human.endload3);
    recordMetric(conditionId, personaTag, "agent_endload3", shapeMetrics.agent.endload3);
    recordMetric(conditionId, personaTag, "human_concede_sum", shapeMetrics.human.concede_sum);
    recordMetric(conditionId, personaTag, "agent_concede_sum", shapeMetrics.agent.concede_sum);
    recordMetric(conditionId, personaTag, "human_toughen_sum", shapeMetrics.human.toughen_sum);
    recordMetric(conditionId, personaTag, "agent_toughen_sum", shapeMetrics.agent.toughen_sum);
    recordMetric(conditionId, personaTag, "human_concede_rate", shapeMetrics.human.concede_rate);
    recordMetric(conditionId, personaTag, "agent_concede_rate", shapeMetrics.agent.concede_rate);
    recordMetric(conditionId, personaTag, "human_toughen_rate", shapeMetrics.human.toughen_rate);
    recordMetric(conditionId, personaTag, "agent_toughen_rate", shapeMetrics.agent.toughen_rate);
    recordMetric(
      conditionId,
      personaTag,
      "human_repeat_offer_rate",
      shapeMetrics.human.repeat_offer_rate
    );
    recordMetric(
      conditionId,
      personaTag,
      "agent_repeat_offer_rate",
      shapeMetrics.agent.repeat_offer_rate
    );
  
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
  
      const concessions = computeConcessions(offers, weights, issues);
      concessions.forEach((row) => {
        const enriched = {
          session_id: session.session_id,
          condition_id: conditionId,
          persona_tag: personaTag,
          ...row,
        };
        concessionRows.push(enriched);
        if (row.concession === null) return;
        const bucket = row.by === "human" ? humanConcessions : agentConcessions;
        bucket[conditionId] = bucket[conditionId] || [];
        bucket[conditionId].push(row.concession);
        const key = `${conditionId}|${personaTag}|${row.by}|${row.turn}`;
        const entry =
          concessionCurveMap.get(key) || {
            condition_id: conditionId,
            persona_tag: personaTag,
            by: row.by,
            turn: row.turn,
            concessions: [],
            cumulative: [],
            own_utilities: [],
            opponent_utilities: [],
          };
        entry.concessions.push(row.concession);
        entry.cumulative.push(row.cumulative_concession ?? 0);
        entry.own_utilities.push(row.own_utility);
        entry.opponent_utilities.push(row.opponent_utility);
        concessionCurveMap.set(key, entry);
      });
  
      sessionRows.push({
        session_id: session.session_id,
        participant_id: session.participant?.participant_id ?? "",
        condition_id: conditionId,
        persona_tag: session.condition?.persona_tag ?? "",
        created_at: session.created_at,
        outcome_reason: outcome.reason ?? "",
        agreement: agreement ? "yes" : "no",
        duration_seconds: outcome.duration_seconds ?? "",
        duration_label: formatDuration(outcome.duration_seconds ?? 0),
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
      file: path.basename(filePath),
      human_anchor_share: anchors.human.anchor_share ?? "",
      agent_anchor_share: anchors.agent.anchor_share ?? "",
      human_anchor_own_u: anchors.human.anchor_own_u ?? "",
      agent_anchor_own_u: anchors.agent.anchor_own_u ?? "",
      human_anchor_dist_nash_L1: anchors.human.dist_nash_L1 ?? "",
      agent_anchor_dist_nash_L1: anchors.agent.dist_nash_L1 ?? "",
      human_anchor_dist_fair_L1: anchors.human.dist_fair_L1 ?? "",
      agent_anchor_dist_fair_L1: anchors.agent.dist_fair_L1 ?? "",
      human_concede_sum: shapeMetrics.human.concede_sum ?? "",
      agent_concede_sum: shapeMetrics.agent.concede_sum ?? "",
      human_toughen_sum: shapeMetrics.human.toughen_sum ?? "",
      agent_toughen_sum: shapeMetrics.agent.toughen_sum ?? "",
      human_concede_rate: shapeMetrics.human.concede_rate ?? "",
      agent_concede_rate: shapeMetrics.agent.concede_rate ?? "",
      human_toughen_rate: shapeMetrics.human.toughen_rate ?? "",
      agent_toughen_rate: shapeMetrics.agent.toughen_rate ?? "",
      human_rigidity_flat_rate: shapeMetrics.human.rigidity_flat_rate ?? "",
      agent_rigidity_flat_rate: shapeMetrics.agent.rigidity_flat_rate ?? "",
      human_burstiness: shapeMetrics.human.burstiness ?? "",
      agent_burstiness: shapeMetrics.agent.burstiness ?? "",
      human_endload2: shapeMetrics.human.endload2 ?? "",
      agent_endload2: shapeMetrics.agent.endload2 ?? "",
      human_endload3: shapeMetrics.human.endload3 ?? "",
      agent_endload3: shapeMetrics.agent.endload3 ?? "",
      human_repeat_offer_rate: shapeMetrics.human.repeat_offer_rate ?? "",
      agent_repeat_offer_rate: shapeMetrics.agent.repeat_offer_rate ?? "",
    });
  
      offers.forEach((offer) => {
        const offerUtilities = computeWeightedUtility(offer.allocation, weights);
        const row = {
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
    } catch (error) {
      console.warn(
        `[warn] Failed to analyze session ${path.basename(filePath)}: ${error?.message ?? error}`
      );
      continue;
    }
  }

  const conditionOrder = ["neutral", "persona"];
  const orderedConditions = [
    ...conditionOrder.filter((key) => conditionCounts[key]),
    ...Object.keys(conditionCounts).filter((key) => !conditionOrder.includes(key)),
  ];

  const summaryMetrics = [
    {
      key: "agreement_rate",
      label: "Agreement Rate",
      direction: "higher",
      values: orderedConditions.map((id) => average(agreementRates[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "joint_utility",
      label: "Avg Joint Utility",
      direction: "higher",
      values: orderedConditions.map((id) => average(jointUtilities[id] ?? [])),
      numFmt: "0.00",
    },
    {
      key: "efficiency",
      label: "Avg Efficiency",
      direction: "higher",
      values: orderedConditions.map((id) => average(efficiencies[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "fairness_index",
      label: "Avg Fairness Index",
      direction: "higher",
      values: orderedConditions.map((id) => average(fairnessIndexes[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "nash_ratio",
      label: "Avg Nash Ratio",
      direction: "higher",
      values: orderedConditions.map((id) => average(nashRatios[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "nash_distance",
      label: "Avg Nash Distance",
      direction: "lower",
      values: orderedConditions.map((id) => average(nashDistances[id] ?? [])),
      numFmt: "0.00",
    },
    {
      key: "pareto_rate",
      label: "Pareto Efficiency Rate",
      direction: "higher",
      values: orderedConditions.map((id) => average(paretoRates[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "human_share",
      label: "Avg Human Share",
      direction: "context",
      values: orderedConditions.map((id) => average(humanShares[id] ?? [])),
      numFmt: "0.0%",
    },
    {
      key: "response_latency",
      label: "Avg Offer Response (s)",
      direction: "lower",
      values: orderedConditions.map((id) => average(responseLatencies[id] ?? [])),
      numFmt: "0.0",
    },
  ];

  const comparisonDefinitions = [
    { key: "agreement_rate", label: "Agreement Rate" },
    { key: "turns_to_agreement", label: "Turns to Agreement" },
    { key: "joint_utility", label: "Joint Utility" },
    { key: "nash_product", label: "Nash Product" },
    { key: "pareto_efficiency_gap", label: "Pareto Efficiency Gap" },
    { key: "human_anchor_share", label: "Human Anchor Share" },
    { key: "agent_anchor_share", label: "Agent Anchor Share" },
    { key: "human_burstiness", label: "Human Burstiness" },
    { key: "agent_burstiness", label: "Agent Burstiness" },
    { key: "human_rigidity_flat_rate", label: "Human Rigidity Flat Rate" },
    { key: "agent_rigidity_flat_rate", label: "Agent Rigidity Flat Rate" },
    { key: "human_endload2", label: "Human Endload2" },
    { key: "agent_endload2", label: "Agent Endload2" },
  ];

  const comparisonRows = [];
  const comparisonPairs = [
    {
      groupA: "neutral",
      groupB: "persona",
      label: "neutral_vs_persona",
      sourceA: "condition",
      sourceB: "condition",
    },
  ];
  Object.keys(personaMetricValues)
    .sort((a, b) => a.localeCompare(b))
    .forEach((personaTag) => {
      comparisonPairs.push({
        groupA: "neutral",
        groupB: personaTag,
        label: `neutral_vs_${personaTag}`,
        sourceA: "condition",
        sourceB: "persona",
      });
    });

  const getGroupValues = (source, group, key) => {
    if (source === "persona") {
      return personaMetricValues[group]?.[key] ?? [];
    }
    return conditionMetricValues[group]?.[key] ?? [];
  };

  comparisonPairs.forEach((pair) => {
    comparisonDefinitions.forEach((metric) => {
      const valuesA = getGroupValues(pair.sourceA, pair.groupA, metric.key);
      const valuesB = getGroupValues(pair.sourceB, pair.groupB, metric.key);
      if (!valuesA.length && !valuesB.length) return;
      const statsA = bootstrapCI(valuesA);
      const statsB = bootstrapCI(valuesB, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED + 5);
      const diffCI = bootstrapDiffCI(valuesA, valuesB);
      const cohens = cohensD(valuesA, valuesB);
      comparisonRows.push({
        metric_name: metric.label,
        groupA_name: pair.groupA,
        groupB_name: pair.groupB,
        group_label: pair.label,
        nA: valuesA.length,
        meanA: statsA.mean,
        stdA: statsA.std,
        ciA_low: statsA.ci_low,
        ciA_high: statsA.ci_high,
        nB: valuesB.length,
        meanB: statsB.mean,
        stdB: statsB.std,
        ciB_low: statsB.ci_low,
        ciB_high: statsB.ci_high,
        diff_mean:
          statsA.mean !== null && statsB.mean !== null ? statsA.mean - statsB.mean : null,
        bootstrap_CI_diff_low: diffCI.ci_low,
        bootstrap_CI_diff_high: diffCI.ci_high,
        cohens_d: cohens,
      });
    });
  });

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
  const concessionLookup = new Map();
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

  const concessionValues = plotRows.flatMap((row) =>
    [
      row.neutral_human_concession,
      row.neutral_agent_concession,
      row.persona_human_concession,
      row.persona_agent_concession,
    ].filter((val) => typeof val === "number")
  );
  const concessionMax = concessionValues.length ? Math.max(...concessionValues) : 0;

  const anchorPlotRows = [];
  const rigidityBurstinessRows = [];
  const orderedRoles = ["human", "agent"];
  orderedConditions.forEach((conditionId) => {
    orderedRoles.forEach((role) => {
      const anchorKey = role === "human" ? "human_anchor_share" : "agent_anchor_share";
      const anchorValues = conditionMetricValues[conditionId]?.[anchorKey] ?? [];
      const anchorStats = bootstrapCI(anchorValues, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED + 21);
      anchorPlotRows.push({
        metric: "Anchor Share",
        condition: conditionId,
        role,
        mean: anchorStats.mean,
        ci_low: anchorStats.ci_low,
        ci_high: anchorStats.ci_high,
        n: anchorValues.length,
      });

      const rigidityKey =
        role === "human" ? "human_rigidity_flat_rate" : "agent_rigidity_flat_rate";
      const burstKey = role === "human" ? "human_burstiness" : "agent_burstiness";
      const rigidityValues = conditionMetricValues[conditionId]?.[rigidityKey] ?? [];
      const burstValues = conditionMetricValues[conditionId]?.[burstKey] ?? [];
      const rigidityStats = bootstrapCI(rigidityValues, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED + 31);
      const burstStats = bootstrapCI(burstValues, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED + 41);
      rigidityBurstinessRows.push({
        metric: "Rigidity Flat Rate",
        condition: conditionId,
        role,
        mean: rigidityStats.mean,
        ci_low: rigidityStats.ci_low,
        ci_high: rigidityStats.ci_high,
        n: rigidityValues.length,
      });
      rigidityBurstinessRows.push({
        metric: "Burstiness",
        condition: conditionId,
        role,
        mean: burstStats.mean,
        ci_low: burstStats.ci_low,
        ci_high: burstStats.ci_high,
        n: burstValues.length,
      });
    });
  });

  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Condition", key: "condition" },
    { header: "Sessions", key: "sessions" },
    { header: "Agreement Rate", key: "agreement_rate" },
    { header: "Avg Joint Utility", key: "avg_joint_utility" },
    { header: "Avg Efficiency", key: "avg_efficiency" },
    { header: "Avg Fairness Index", key: "avg_fairness_index" },
    { header: "Avg Nash Product", key: "avg_nash_product" },
    { header: "Avg Nash Ratio", key: "avg_nash_ratio" },
    { header: "Avg Nash Distance", key: "avg_nash_distance" },
    { header: "Pareto Efficiency Rate", key: "pareto_efficiency_rate" },
    { header: "Avg Human Share", key: "avg_human_share" },
    { header: "Avg Duration (s)", key: "avg_duration" },
    { header: "Avg Turns", key: "avg_turns" },
    { header: "Avg Offer Response (s)", key: "avg_response" },
    { header: "Avg Human Concession", key: "avg_human_concession" },
    { header: "Avg Agent Concession", key: "avg_agent_concession" },
    { header: "Human Anchor Share", key: "human_anchor_share" },
    { header: "Agent Anchor Share", key: "agent_anchor_share" },
    { header: "Human Anchor Own Utility", key: "human_anchor_own_u" },
    { header: "Agent Anchor Own Utility", key: "agent_anchor_own_u" },
    { header: "Human Anchor Dist Nash L1", key: "human_anchor_dist_nash_L1" },
    { header: "Agent Anchor Dist Nash L1", key: "agent_anchor_dist_nash_L1" },
    { header: "Human Anchor Dist Fair L1", key: "human_anchor_dist_fair_L1" },
    { header: "Agent Anchor Dist Fair L1", key: "agent_anchor_dist_fair_L1" },
    { header: "Human Concede Sum", key: "human_concede_sum" },
    { header: "Agent Concede Sum", key: "agent_concede_sum" },
    { header: "Human Toughen Sum", key: "human_toughen_sum" },
    { header: "Agent Toughen Sum", key: "agent_toughen_sum" },
    { header: "Human Concede Rate", key: "human_concede_rate" },
    { header: "Agent Concede Rate", key: "agent_concede_rate" },
    { header: "Human Toughen Rate", key: "human_toughen_rate" },
    { header: "Agent Toughen Rate", key: "agent_toughen_rate" },
    { header: "Human Rigidity Flat Rate", key: "human_rigidity_flat_rate" },
    { header: "Agent Rigidity Flat Rate", key: "agent_rigidity_flat_rate" },
    { header: "Human Burstiness", key: "human_burstiness" },
    { header: "Agent Burstiness", key: "agent_burstiness" },
    { header: "Human Endload2", key: "human_endload2" },
    { header: "Agent Endload2", key: "agent_endload2" },
    { header: "Human Endload3", key: "human_endload3" },
    { header: "Agent Endload3", key: "agent_endload3" },
    { header: "Human Repeat Offer Rate", key: "human_repeat_offer_rate" },
    { header: "Agent Repeat Offer Rate", key: "agent_repeat_offer_rate" },
  ];
  styleHeader(summarySheet.getRow(1));

  orderedConditions.forEach((conditionId) => {
    summarySheet.addRow({
      condition: conditionId,
      sessions: conditionCounts[conditionId],
      agreement_rate: average(agreementRates[conditionId]) ?? "",
      avg_joint_utility: average(jointUtilities[conditionId]) ?? "",
      avg_efficiency: average(efficiencies[conditionId]) ?? "",
      avg_fairness_index: average(fairnessIndexes[conditionId]) ?? "",
      avg_nash_product: average(nashProducts[conditionId]) ?? "",
      avg_nash_ratio: average(nashRatios[conditionId]) ?? "",
      avg_nash_distance: average(nashDistances[conditionId]) ?? "",
      pareto_efficiency_rate: average(paretoRates[conditionId]) ?? "",
      avg_human_share: average(humanShares[conditionId]) ?? "",
      avg_duration: average(durations[conditionId]) ?? "",
      avg_turns: average(turnCounts[conditionId]) ?? "",
      avg_response: average(responseLatencies[conditionId]) ?? "",
      avg_human_concession: average(humanConcessions[conditionId] ?? []) ?? "",
      avg_agent_concession: average(agentConcessions[conditionId] ?? []) ?? "",
      human_anchor_share: average(conditionMetricValues[conditionId]?.human_anchor_share ?? []) ?? "",
      agent_anchor_share: average(conditionMetricValues[conditionId]?.agent_anchor_share ?? []) ?? "",
      human_anchor_own_u: average(conditionMetricValues[conditionId]?.human_anchor_own_u ?? []) ?? "",
      agent_anchor_own_u: average(conditionMetricValues[conditionId]?.agent_anchor_own_u ?? []) ?? "",
      human_anchor_dist_nash_L1: average(conditionMetricValues[conditionId]?.human_anchor_dist_nash_L1 ?? []) ?? "",
      agent_anchor_dist_nash_L1: average(conditionMetricValues[conditionId]?.agent_anchor_dist_nash_L1 ?? []) ?? "",
      human_anchor_dist_fair_L1: average(conditionMetricValues[conditionId]?.human_anchor_dist_fair_L1 ?? []) ?? "",
      agent_anchor_dist_fair_L1: average(conditionMetricValues[conditionId]?.agent_anchor_dist_fair_L1 ?? []) ?? "",
      human_concede_sum: average(conditionMetricValues[conditionId]?.human_concede_sum ?? []) ?? "",
      agent_concede_sum: average(conditionMetricValues[conditionId]?.agent_concede_sum ?? []) ?? "",
      human_toughen_sum: average(conditionMetricValues[conditionId]?.human_toughen_sum ?? []) ?? "",
      agent_toughen_sum: average(conditionMetricValues[conditionId]?.agent_toughen_sum ?? []) ?? "",
      human_concede_rate: average(conditionMetricValues[conditionId]?.human_concede_rate ?? []) ?? "",
      agent_concede_rate: average(conditionMetricValues[conditionId]?.agent_concede_rate ?? []) ?? "",
      human_toughen_rate: average(conditionMetricValues[conditionId]?.human_toughen_rate ?? []) ?? "",
      agent_toughen_rate: average(conditionMetricValues[conditionId]?.agent_toughen_rate ?? []) ?? "",
      human_rigidity_flat_rate: average(conditionMetricValues[conditionId]?.human_rigidity_flat_rate ?? []) ?? "",
      agent_rigidity_flat_rate: average(conditionMetricValues[conditionId]?.agent_rigidity_flat_rate ?? []) ?? "",
      human_burstiness: average(conditionMetricValues[conditionId]?.human_burstiness ?? []) ?? "",
      agent_burstiness: average(conditionMetricValues[conditionId]?.agent_burstiness ?? []) ?? "",
      human_endload2: average(conditionMetricValues[conditionId]?.human_endload2 ?? []) ?? "",
      agent_endload2: average(conditionMetricValues[conditionId]?.agent_endload2 ?? []) ?? "",
      human_endload3: average(conditionMetricValues[conditionId]?.human_endload3 ?? []) ?? "",
      agent_endload3: average(conditionMetricValues[conditionId]?.agent_endload3 ?? []) ?? "",
      human_repeat_offer_rate: average(conditionMetricValues[conditionId]?.human_repeat_offer_rate ?? []) ?? "",
      agent_repeat_offer_rate: average(conditionMetricValues[conditionId]?.agent_repeat_offer_rate ?? []) ?? "",
    });
  });
  applyZebra(summarySheet);
  autoWidth(summarySheet);
  applySheetLayout(summarySheet);
  setAutoFilter(summarySheet);
  formatColumns(summarySheet, {
    sessions: { numFmt: "0", alignment: { horizontal: "center", vertical: "middle" } },
    agreement_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    avg_efficiency: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    avg_fairness_index: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    avg_nash_ratio: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    pareto_efficiency_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    avg_human_share: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    avg_joint_utility: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    avg_nash_product: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    avg_nash_distance: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    avg_duration: { numFmt: "0.0", alignment: { horizontal: "center", vertical: "middle" } },
    avg_turns: { numFmt: "0.0", alignment: { horizontal: "center", vertical: "middle" } },
    avg_response: { numFmt: "0.0", alignment: { horizontal: "center", vertical: "middle" } },
    avg_human_concession: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    avg_agent_concession: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_anchor_share: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_anchor_share: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_anchor_own_u: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_anchor_own_u: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_anchor_dist_nash_L1: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_anchor_dist_nash_L1: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_anchor_dist_fair_L1: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_anchor_dist_fair_L1: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_concede_sum: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_concede_sum: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_toughen_sum: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_toughen_sum: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_concede_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_concede_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_toughen_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_toughen_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_rigidity_flat_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_rigidity_flat_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_burstiness: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    agent_burstiness: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    human_endload2: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_endload2: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_endload3: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_endload3: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    human_repeat_offer_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
    agent_repeat_offer_rate: { numFmt: "0.0%", alignment: { horizontal: "center", vertical: "middle" } },
  });
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const conditionCell = row.getCell("condition");
    if (conditionCell.value === "persona") {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.personaFill },
        };
      });
      conditionCell.font = { color: { argb: COLORS.personaText }, bold: true };
    } else if (conditionCell.value === "neutral") {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.neutralFill },
        };
      });
      conditionCell.font = { color: { argb: COLORS.neutralText }, bold: true };
    }
  });

  const sessionSheet = workbook.addWorksheet("Sessions");
  sessionSheet.columns = Object.keys(sessionRows[0] || {}).map((key) => ({ header: key, key }));
  sessionRows.forEach((row) => sessionSheet.addRow(row));
  styleHeader(sessionSheet.getRow(1));
  applyZebra(sessionSheet);
  autoWidth(sessionSheet);
  applySheetLayout(sessionSheet);
  setAutoFilter(sessionSheet);
  formatColumns(sessionSheet, {
    efficiency: { numFmt: "0.0%" },
    fairness_index: { numFmt: "0.0%" },
    nash_ratio: { numFmt: "0.0%" },
    human_share: { numFmt: "0.0%" },
    human_anchor_share: { numFmt: "0.0%" },
    agent_anchor_share: { numFmt: "0.0%" },
    human_concede_rate: { numFmt: "0.0%" },
    agent_concede_rate: { numFmt: "0.0%" },
    human_toughen_rate: { numFmt: "0.0%" },
    agent_toughen_rate: { numFmt: "0.0%" },
    human_rigidity_flat_rate: { numFmt: "0.0%" },
    agent_rigidity_flat_rate: { numFmt: "0.0%" },
    human_endload2: { numFmt: "0.0%" },
    agent_endload2: { numFmt: "0.0%" },
    human_endload3: { numFmt: "0.0%" },
    agent_endload3: { numFmt: "0.0%" },
    human_repeat_offer_rate: { numFmt: "0.0%" },
    agent_repeat_offer_rate: { numFmt: "0.0%" },
  });
  sessionSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const conditionCell = row.getCell("condition_id");
    if (conditionCell.value === "persona") {
      conditionCell.font = { color: { argb: "FF2563EB" }, bold: true };
    } else {
      conditionCell.font = { color: { argb: "FF334155" }, bold: true };
    }
    const outcomeCell = row.getCell("outcome_reason");
    if (outcomeCell.value === "agreement") {
      outcomeCell.font = { color: { argb: "FF16A34A" }, bold: true };
    } else {
      outcomeCell.font = { color: { argb: "FFDC2626" }, bold: true };
    }
  });

  const offerSheet = workbook.addWorksheet("Offers");
  offerSheet.columns = Object.keys(offerRows[0] || {}).map((key) => ({ header: key, key }));
  offerRows.forEach((row) => offerSheet.addRow(row));
  styleHeader(offerSheet.getRow(1));
  applyZebra(offerSheet);
  autoWidth(offerSheet);
  applySheetLayout(offerSheet);
  setAutoFilter(offerSheet);

  const chatSheet = workbook.addWorksheet("Chat");
  chatSheet.columns = Object.keys(chatRows[0] || {}).map((key) => ({ header: key, key }));
  chatRows.forEach((row) => chatSheet.addRow(row));
  styleHeader(chatSheet.getRow(1));
  applyZebra(chatSheet);
  autoWidth(chatSheet);
  applySheetLayout(chatSheet);
  setAutoFilter(chatSheet);
  formatColumns(chatSheet, {
    content: { alignment: { wrapText: true, vertical: "top" } },
  });

  const surveySheet = workbook.addWorksheet("Survey");
  surveySheet.columns = Object.keys(surveyRows[0] || {}).map((key) => ({ header: key, key }));
  surveyRows.forEach((row) => surveySheet.addRow(row));
  styleHeader(surveySheet.getRow(1));
  applyZebra(surveySheet);
  autoWidth(surveySheet);
  applySheetLayout(surveySheet);
  setAutoFilter(surveySheet);

  const concessionSheet = workbook.addWorksheet("Concessions");
  concessionSheet.columns = Object.keys(concessionRows[0] || {}).map((key) => ({
    header: key,
    key,
  }));
  concessionRows.forEach((row) => concessionSheet.addRow(row));
  styleHeader(concessionSheet.getRow(1));
  applyZebra(concessionSheet);
  autoWidth(concessionSheet);
  applySheetLayout(concessionSheet);
  setAutoFilter(concessionSheet);

  const concessionCurveSheet = workbook.addWorksheet("ConcessionCurves");
  concessionCurveSheet.columns = Object.keys(concessionCurveRows[0] || {}).map((key) => ({
    header: key,
    key,
  }));
  concessionCurveRows.forEach((row) => concessionCurveSheet.addRow(row));
  styleHeader(concessionCurveSheet.getRow(1));
  applyZebra(concessionCurveSheet);
  autoWidth(concessionCurveSheet);
  applySheetLayout(concessionCurveSheet);
  setAutoFilter(concessionCurveSheet);

  const dashboardSheet = workbook.addWorksheet("Dashboard");
  dashboardSheet.columns = [
    { header: "Metric", key: "metric" },
    { header: "Neutral", key: "neutral" },
    { header: "Persona", key: "persona" },
    { header: "Direction", key: "direction" },
    { header: "Neutral Bar", key: "neutral_bar" },
    { header: "Persona Bar", key: "persona_bar" },
  ];
  summaryMetrics.forEach((metric) => {
    const neutralValue = orderedConditions.includes("neutral") ? metric.values[orderedConditions.indexOf("neutral")] : "";
    const personaValue = orderedConditions.includes("persona") ? metric.values[orderedConditions.indexOf("persona")] : "";
    const maxValue = Math.max(
      ...metric.values.filter((val) => typeof val === "number" && val >= 0)
    );
    dashboardSheet.addRow({
      metric: metric.label,
      neutral: neutralValue ?? "",
      persona: personaValue ?? "",
      direction: metric.direction,
      neutral_bar: buildBar(neutralValue, maxValue),
      persona_bar: buildBar(personaValue, maxValue),
    });
  });
  styleHeader(dashboardSheet.getRow(1));
  applyZebra(dashboardSheet);
  autoWidth(dashboardSheet);
  applySheetLayout(dashboardSheet);
  setAutoFilter(dashboardSheet);
  formatColumns(dashboardSheet, {
    neutral: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    persona: { numFmt: "0.00", alignment: { horizontal: "center", vertical: "middle" } },
    neutral_bar: { alignment: { horizontal: "left", vertical: "middle" } },
    persona_bar: { alignment: { horizontal: "left", vertical: "middle" } },
  });
  summaryMetrics.forEach((metric, index) => {
    const row = dashboardSheet.getRow(index + 2);
    if (metric.numFmt) {
      row.getCell("neutral").numFmt = metric.numFmt;
      row.getCell("persona").numFmt = metric.numFmt;
    }
    const directionCell = row.getCell("direction");
    if (metric.direction === "higher") {
      directionCell.font = { color: { argb: COLORS.positive }, bold: true };
    } else if (metric.direction === "lower") {
      directionCell.font = { color: { argb: COLORS.negative }, bold: true };
    } else {
      directionCell.font = { color: { argb: COLORS.caution }, bold: true };
    }
    row.getCell("neutral").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.neutralFill },
    };
    row.getCell("persona").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.personaFill },
    };
    row.getCell("neutral_bar").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.neutralFill },
    };
    row.getCell("persona_bar").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.personaFill },
    };
  });

  const plotsSheet = workbook.addWorksheet("Plots");
  plotsSheet.columns = [
    { header: "Turn", key: "turn" },
    { header: "Neutral Human Concession", key: "neutral_human_concession" },
    { header: "Neutral Agent Concession", key: "neutral_agent_concession" },
    { header: "Persona Human Concession", key: "persona_human_concession" },
    { header: "Persona Agent Concession", key: "persona_agent_concession" },
    { header: "Neutral Human Utility", key: "neutral_human_utility" },
    { header: "Neutral Agent Utility", key: "neutral_agent_utility" },
    { header: "Persona Human Utility", key: "persona_human_utility" },
    { header: "Persona Agent Utility", key: "persona_agent_utility" },
    { header: "Neutral Human Bar", key: "neutral_human_bar" },
    { header: "Neutral Agent Bar", key: "neutral_agent_bar" },
    { header: "Persona Human Bar", key: "persona_human_bar" },
    { header: "Persona Agent Bar", key: "persona_agent_bar" },
  ];
  plotRows.forEach((row) => {
    plotsSheet.addRow({
      ...row,
      neutral_human_bar: buildBar(row.neutral_human_concession, concessionMax),
      neutral_agent_bar: buildBar(row.neutral_agent_concession, concessionMax),
      persona_human_bar: buildBar(row.persona_human_concession, concessionMax),
      persona_agent_bar: buildBar(row.persona_agent_concession, concessionMax),
    });
  });
  const plotHeaderRows = [];
  if (anchorPlotRows.length || rigidityBurstinessRows.length) {
    plotsSheet.addRow([]);
    const anchorHeaderRow = plotsSheet.addRow([
      "Anchoring Metrics (mean + 95% CI)",
      "Condition",
      "Role",
      "Mean",
      "CI Low",
      "CI High",
      "N",
    ]);
    plotHeaderRows.push(anchorHeaderRow.number);
    anchorPlotRows.forEach((row) => {
      plotsSheet.addRow([
        row.metric,
        row.condition,
        row.role,
        row.mean ?? "",
        row.ci_low ?? "",
        row.ci_high ?? "",
        row.n ?? "",
      ]);
    });
    plotsSheet.addRow([]);
    const rigidityHeaderRow = plotsSheet.addRow([
      "Rigidity & Burstiness (mean + 95% CI)",
      "Condition",
      "Role",
      "Mean",
      "CI Low",
      "CI High",
      "N",
    ]);
    plotHeaderRows.push(rigidityHeaderRow.number);
    rigidityBurstinessRows.forEach((row) => {
      plotsSheet.addRow([
        row.metric,
        row.condition,
        row.role,
        row.mean ?? "",
        row.ci_low ?? "",
        row.ci_high ?? "",
        row.n ?? "",
      ]);
    });
  }

  applyZebra(plotsSheet);
  autoWidth(plotsSheet);
  applySheetLayout(plotsSheet);
  setAutoFilter(plotsSheet);
  formatColumns(plotsSheet, {
    neutral_human_concession: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    neutral_agent_concession: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    persona_human_concession: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    persona_agent_concession: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    neutral_human_utility: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    neutral_agent_utility: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    persona_human_utility: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
    persona_agent_utility: {
      numFmt: "0.00",
      alignment: { horizontal: "center", vertical: "middle" },
    },
  });
  plotsSheet.getColumn("neutral_human_concession").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("neutral_agent_concession").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("neutral_human_utility").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("neutral_agent_utility").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("persona_human_concession").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  plotsSheet.getColumn("persona_agent_concession").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  plotsSheet.getColumn("persona_human_utility").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  plotsSheet.getColumn("persona_agent_utility").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  plotsSheet.getColumn("neutral_human_bar").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("neutral_agent_bar").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.neutralFill } };
  });
  plotsSheet.getColumn("persona_human_bar").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  plotsSheet.getColumn("persona_agent_bar").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.personaFill } };
  });
  styleHeader(plotsSheet.getRow(1));
  plotHeaderRows.forEach((rowNumber) => styleHeader(plotsSheet.getRow(rowNumber)));

  const comparisonsSheet = workbook.addWorksheet("Comparisons");
  comparisonsSheet.columns = [
    { header: "Metric", key: "metric_name" },
    { header: "Group A", key: "groupA_name" },
    { header: "Group B", key: "groupB_name" },
    { header: "Comparison", key: "group_label" },
    { header: "nA", key: "nA" },
    { header: "Mean A", key: "meanA" },
    { header: "Std A", key: "stdA" },
    { header: "CI A Low", key: "ciA_low" },
    { header: "CI A High", key: "ciA_high" },
    { header: "nB", key: "nB" },
    { header: "Mean B", key: "meanB" },
    { header: "Std B", key: "stdB" },
    { header: "CI B Low", key: "ciB_low" },
    { header: "CI B High", key: "ciB_high" },
    { header: "Diff Mean (A-B)", key: "diff_mean" },
    { header: "Diff CI Low", key: "bootstrap_CI_diff_low" },
    { header: "Diff CI High", key: "bootstrap_CI_diff_high" },
    { header: "Cohen's d", key: "cohens_d" },
  ];
  comparisonRows.forEach((row) => comparisonsSheet.addRow(row));
  styleHeader(comparisonsSheet.getRow(1));
  applyZebra(comparisonsSheet);
  autoWidth(comparisonsSheet);
  applySheetLayout(comparisonsSheet);
  setAutoFilter(comparisonsSheet);
  formatColumns(comparisonsSheet, {
    nA: { numFmt: "0" },
    nB: { numFmt: "0" },
    meanA: { numFmt: "0.000" },
    meanB: { numFmt: "0.000" },
    stdA: { numFmt: "0.000" },
    stdB: { numFmt: "0.000" },
    ciA_low: { numFmt: "0.000" },
    ciA_high: { numFmt: "0.000" },
    ciB_low: { numFmt: "0.000" },
    ciB_high: { numFmt: "0.000" },
    diff_mean: { numFmt: "0.000" },
    bootstrap_CI_diff_low: { numFmt: "0.000" },
    bootstrap_CI_diff_high: { numFmt: "0.000" },
    cohens_d: { numFmt: "0.000" },
  });

  const legendSheet = workbook.addWorksheet("Legend");
  legendSheet.columns = [
    { header: "Metric", key: "metric" },
    { header: "Definition", key: "definition" },
    { header: "Range", key: "range" },
    { header: "Direction", key: "direction" },
    { header: "Notes", key: "notes" },
  ];
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
      metric: "Anchor Share",
      definition: "Share of utility claimed by the offerer in their first offer.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more aggressive initial anchor.",
    },
    {
      metric: "Anchor Dist Nash L1",
      definition: "L1 distance from first offer to Nash utilities.",
      range: ">= 0",
      direction: "Lower is better",
      notes: "0 = first offer at Nash point.",
    },
    {
      metric: "Anchor Dist Fair L1",
      definition: "L1 distance from first offer to fair split utilities.",
      range: ">= 0",
      direction: "Lower is better",
      notes: "0 = first offer at fair split.",
    },
    {
      metric: "Concede Sum",
      definition: "Total positive concessions across offers.",
      range: ">= 0",
      direction: "Context dependent",
      notes: "Higher = more total concessions.",
    },
    {
      metric: "Toughen Sum",
      definition: "Total toughening (negative concessions).",
      range: ">= 0",
      direction: "Context dependent",
      notes: "Higher = more aggressive moves.",
    },
    {
      metric: "Concede Rate",
      definition: "Share of deltas that are concessions.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more frequent concessions.",
    },
    {
      metric: "Toughen Rate",
      definition: "Share of deltas that are toughening.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more frequent toughening.",
    },
    {
      metric: "Rigidity Flat Rate",
      definition: "Share of deltas near zero (no movement).",
      range: "0-1",
      direction: "Higher is more rigid",
      notes: "Higher = more rigid/flat offers.",
    },
    {
      metric: "Burstiness",
      definition: "Max |delta| / mean |delta| across offers.",
      range: ">= 0",
      direction: "Context dependent",
      notes: "Higher = moves concentrated in bursts.",
    },
    {
      metric: "Endload2",
      definition: "Share of total movement in last 2 deltas.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more end-loaded concessions.",
    },
    {
      metric: "Endload3",
      definition: "Share of total movement in last 3 deltas.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more end-loaded concessions.",
    },
    {
      metric: "Repeat Offer Rate",
      definition: "Share of consecutive offers that are identical.",
      range: "0-1",
      direction: "Context dependent",
      notes: "Higher = more repetition.",
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
  legendRows.forEach((row) => legendSheet.addRow(row));
  styleHeader(legendSheet.getRow(1));
  applyZebra(legendSheet);
  autoWidth(legendSheet);
  applySheetLayout(legendSheet);
  setAutoFilter(legendSheet);
  applyAlignment(legendSheet, { wrapColumns: ["definition", "notes"] });
  legendSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const directionCell = row.getCell("direction");
    if (directionCell.value === "Higher is better") {
      directionCell.font = { color: { argb: COLORS.positive }, bold: true };
    } else if (directionCell.value === "Lower is better") {
      directionCell.font = { color: { argb: COLORS.negative }, bold: true };
    } else {
      directionCell.font = { color: { argb: COLORS.caution }, bold: true };
    }
  });

  const reportDir = path.dirname(out);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  await workbook.xlsx.writeFile(out);
  console.log(`Report saved to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

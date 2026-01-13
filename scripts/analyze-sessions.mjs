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

const allocationCache = new Map();

function getAllocationStats(issues, weights) {
  const key = JSON.stringify(issues.map((issue) => ({ key: issue.key, total: issue.total })));
  if (allocationCache.has(key)) {
    return allocationCache.get(key);
  }

  const allocations = generateAllocations(issues).map((allocation) => ({
    allocation,
    utilities: computeWeightedUtility(allocation, weights),
  }));

  const frontier = computeParetoFrontier(allocations);
  const frontierSet = new Set(
    frontier.map((point) => `${point.utilities.human}|${point.utilities.agent}`)
  );
  const nash = computeNashPoint(allocations);
  const maxJoint = computeMaxJointUtility({ issues }, weights);

  const stats = {
    allocations,
    frontierSet,
    nash,
    maxJoint,
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

function computeConcessions(offers, weights) {
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
    });
  });

  const rows = [];
  Object.entries(byRole).forEach(([by, roleOffers]) => {
    let previousOwn = null;
    let cumulative = 0;
    roleOffers.forEach((offer) => {
      let concession = null;
      if (previousOwn !== null) {
        concession = previousOwn - offer.own_utility;
        cumulative += concession;
      }
      rows.push({
        by,
        turn: offer.turn,
        created_at: offer.created_at,
        own_utility: offer.own_utility,
        opponent_utility: offer.opponent_utility,
        joint_utility: offer.joint_utility,
        concession,
        cumulative_concession: previousOwn === null ? null : cumulative,
        own_share:
          offer.joint_utility ? offer.own_utility / offer.joint_utility : null,
      });
      previousOwn = offer.own_utility;
    });
  });
  return rows;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
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

  for (const { filePath, session } of sessions) {
    const events = getEvents(session);
    const offers = collectOffers(events);
    const chats = collectChats(events);
    const outcome = session.outcome ?? {};
    const conditionId = session.condition?.id ?? "unknown";
    const personaTag = session.condition?.persona_tag ?? "";
    const issues = session.config?.issues ?? [];
    const allocationStats = issues.length ? getAllocationStats(issues, weights) : null;
    const maxJoint = allocationStats?.maxJoint ?? computeMaxJointUtility(session.config, weights);

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
  styleHeader(plotsSheet.getRow(1));
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

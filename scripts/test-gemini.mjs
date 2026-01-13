import fs from "fs";
import path from "path";

const DEFAULT_MODEL = "gemini-2.5-flash";
const ISSUES = [
  { key: "snacks", label: "Snack Packs", total: 8 },
  { key: "breaks", label: "Break Minutes", total: 10 },
  { key: "music", label: "Music Picks", total: 6 },
  { key: "tickets", label: "Prize Tickets", total: 8 },
];
const SYSTEM_PROMPT_OFFER =
  "You are a negotiation agent in a multi-issue bargaining game. Output JSON only. Do not include markdown, code fences, or any extra text.";
const SYSTEM_PROMPT_CHAT =
  "You are a negotiation agent in a multi-issue bargaining game. Respond in 1 to 3 sentences. Do not output JSON or tables.";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { model: undefined, prompt: undefined, list: false, mode: "offer" };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") {
      parsed.model = args[i + 1];
      i += 1;
    } else if (arg === "--prompt") {
      parsed.prompt = args[i + 1];
      i += 1;
    } else if (arg === "--mode") {
      parsed.mode = args[i + 1] ?? "offer";
      i += 1;
    } else if (arg === "--list") {
      parsed.list = true;
    } else if (!parsed.prompt && !arg.startsWith("--")) {
      parsed.prompt = arg;
    }
  }
  return parsed;
}

async function listModels(apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ListModels failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const models = Array.isArray(data.models) ? data.models : [];
  return models;
}

function normalizeModelName(name) {
  return name.replace(/^models\//, "");
}

function pickDefaultModel(models) {
  const supported = models.filter((model) =>
    (model.supportedGenerationMethods || []).includes("generateContent")
  );
  if (supported.length === 0) return null;

  const candidates = ["gemini-2.5-flash"];

  for (const candidate of candidates) {
    const match = supported.find(
      (model) => normalizeModelName(model.name) === candidate
    );
    if (match) return match.name;
  }

  return supported[0].name;
}

function extractBestCandidate(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  if (candidates.length === 0) {
    return { text: "", finishReason: "unknown", index: -1 };
  }
  const scored = candidates.map((candidate, index) => {
    const parts = candidate?.content?.parts ?? [];
    const partsText = parts.map((part) => part.text ?? "").join("");
    const contentText = candidate?.content?.text ?? "";
    const text = (partsText || contentText || "").trim();
    return { text, finishReason: candidate?.finishReason ?? "unknown", index };
  });
  scored.sort((a, b) => b.text.length - a.text.length);
  return scored[0];
}

function loadWeights() {
  const weightsPath = path.join(process.cwd(), "lib", "weights.json");
  if (!fs.existsSync(weightsPath)) {
    return { human: {}, agent: {} };
  }
  return JSON.parse(fs.readFileSync(weightsPath, "utf8"));
}

function computeUtilities(allocation, weights) {
  let human = 0;
  let agent = 0;
  Object.entries(allocation).forEach(([key, split]) => {
    const humanWeight = weights.human?.[key] ?? 1;
    const agentWeight = weights.agent?.[key] ?? 1;
    human += split.human * humanWeight;
    agent += split.agent * agentWeight;
  });
  return { human, agent, joint: human + agent };
}

function offerToPlainText(offer) {
  return ISSUES.map((issue) => {
    const entry = offer[issue.key];
    return `${issue.label} (total ${issue.total}): Human ${entry.human}, Agent ${entry.agent}`;
  }).join(". ");
}

function summarizeOfferByKey(offer) {
  return ISSUES.map((issue) => {
    const entry = offer[issue.key];
    return `${issue.key} H${entry.human}/A${entry.agent}`;
  }).join(", ");
}

function formatWeights(weights) {
  const human = ISSUES.map(
    (issue) => `${issue.key}=${weights.human?.[issue.key] ?? 1}`
  ).join(",");
  const agent = ISSUES.map(
    (issue) => `${issue.key}=${weights.agent?.[issue.key] ?? 1}`
  ).join(",");
  return `weights human{${human}} agent{${agent}}`;
}

function buildOfferPrompt(personaTag, weights) {
  const lastHumanOffer = {
    snacks: { human: 8, agent: 0 },
    breaks: { human: 2, agent: 8 },
    music: { human: 3, agent: 3 },
    tickets: { human: 2, agent: 6 },
  };
  const issuesSummary = ISSUES.map(
    (issue) => `${issue.key}=${issue.total}`
  ).join(",");

  const prompt = [
    "Role: negotiation agent. Goal: maximize agent utility. No deal by deadline/turn limit = 0.",
    `persona=${personaTag}`,
    `issues{${issuesSummary}}`,
    formatWeights(weights),
    `last_human_offer{${summarizeOfferByKey(lastHumanOffer)}}`,
    "deadline=180s",
    "turn=2/12",
    "Decision: accept or counter.",
    "Offer rules: use issue keys; integers only; each issue sums to total.",
    "Output JSON only. Use compact offers to save tokens.",
    "{\"decision\":\"accept\"|\"counter\",\"message\":\"<=8 words\",\"offer_compact\":\"snacks=H6/A2,breaks=H3/A7,music=H4/A2,tickets=H2/A6\"}",
    "The message must reference the offer (<=8 words).",
    "Output compact JSON with no extra whitespace or line breaks.",
  ].join("\n");

  return { prompt, lastHumanOffer };
}

function buildChatPrompt(personaTag, weights) {
  const currentOffer = {
    snacks: { human: 6, agent: 2 },
    breaks: { human: 3, agent: 7 },
    music: { human: 4, agent: 2 },
    tickets: { human: 2, agent: 6 },
  };
  const issuesSummary = ISSUES.map(
    (issue) => `${issue.key}=${issue.total}`
  ).join(",");

  const prompt = [
    "Role: negotiation agent. Goal: maximize agent utility. No deal by deadline/turn limit = 0.",
    `persona=${personaTag}`,
    `issues{${issuesSummary}}`,
    formatWeights(weights),
    `current_offer=${offerToPlainText(currentOffer)}`,
    "last_human_offer=snacks H8/A0, breaks H2/A8, music H3/A3, tickets H2/A6",
    "deadline=180s",
    "turn=2/12",
    "Respond in 1-2 sentences (<=40 words). No JSON/tables.",
  ].join("\n");

  return { prompt };
}

function extractJsonBlock(text) {
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  if (withoutFences.startsWith("{") && withoutFences.endsWith("}")) {
    return withoutFences;
  }
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response.");
  }
  return withoutFences.slice(start, end + 1);
}

function validateOffer(offer, issues) {
  issues.forEach((issue) => {
    const entry = offer?.[issue.key];
    if (!entry) {
      throw new Error(`Missing allocation for ${issue.key}.`);
    }
    if (!Number.isInteger(entry.human) || !Number.isInteger(entry.agent)) {
      throw new Error(`Non-integer allocation for ${issue.key}.`);
    }
    if (entry.human < 0 || entry.agent < 0) {
      throw new Error(`Negative allocation for ${issue.key}.`);
    }
    if (entry.human + entry.agent !== issue.total) {
      throw new Error(`Allocation for ${issue.key} does not sum to ${issue.total}.`);
    }
  });
}

function parseCompactOffer(text) {
  const allocation = {};
  const normalized = text.replace(/\s+/g, "");
  const parts = normalized.split(",").filter(Boolean);
  for (const part of parts) {
    const match = part.match(/^([a-zA-Z0-9_-]+)=H(\d+)\/A(\d+)$/);
    if (!match) {
      throw new Error(`Invalid compact offer segment "${part}".`);
    }
    const key = match[1];
    allocation[key] = {
      human: Number.parseInt(match[2], 10),
      agent: Number.parseInt(match[3], 10),
    };
  }
  return allocation;
}

async function main() {
  loadEnvFile();
  const { model: argModel, prompt, list, mode } = parseArgs();
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_AI_STUDIO_API_KEY. Set it in .env.local or the shell.");
    process.exit(1);
  }

  const envModel = process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL;
  let model = argModel || envModel;

  const models = await listModels(apiKey);

  if (list) {
    const available = models
      .filter((entry) => (entry.supportedGenerationMethods || []).includes("generateContent"))
      .map((entry) => normalizeModelName(entry.name));
    console.log("Models supporting generateContent:");
    available.forEach((name) => console.log(`- ${name}`));
    return;
  }

  if (!model) {
    model = pickDefaultModel(models);
  }

  if (!model) {
    console.error("No models found that support generateContent.");
    process.exit(1);
  }

  const modelName = model.startsWith("models/") ? model : `models/${model}`;
  const normalizedModelName = normalizeModelName(modelName);
  const modelInfo = models.find(
    (entry) => normalizeModelName(entry.name) === normalizedModelName
  );
  const outputTokenLimit = modelInfo?.outputTokenLimit;
  const weights = loadWeights();
  const resolvedPrompt =
    prompt ??
    (mode === "chat"
      ? buildChatPrompt("neutral", weights).prompt
      : buildOfferPrompt("neutral", weights).prompt);
  const systemPrompt = mode === "chat" ? SYSTEM_PROMPT_CHAT : SYSTEM_PROMPT_OFFER;
  const requestedMaxOutputTokens = mode === "chat" ? 200000 : 700000;
  const maxOutputTokens =
    typeof outputTokenLimit === "number"
      ? Math.min(requestedMaxOutputTokens, outputTokenLimit)
      : requestedMaxOutputTokens;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: resolvedPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: mode === "chat" ? 0.3 : 0.2,
          maxOutputTokens,
          ...(mode === "offer" ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Request failed (${response.status}): ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  const usage = data?.usageMetadata ?? {};
  const best = extractBestCandidate(data);
  const finishReason = best.finishReason ?? "unknown";
  const text = best.text;
  if (!text) {
    console.error("No text returned from Gemini.");
    process.exit(1);
  }

  const usageLine =
    usage?.promptTokenCount || usage?.candidatesTokenCount || usage?.totalTokenCount
      ? ` (prompt=${usage.promptTokenCount ?? "?"}, output=${usage.candidatesTokenCount ?? "?"}, total=${usage.totalTokenCount ?? "?"})`
      : "";
  const limitLine =
    typeof outputTokenLimit === "number"
      ? ` outputLimit=${outputTokenLimit}`
      : "";
  console.log(
    `Gemini raw (${normalizedModelName} | finish=${finishReason}${limitLine})${usageLine}:`,
    text.trim()
  );

  if (finishReason === "MAX_TOKENS") {
    console.error(
      "Gemini response hit MAX_TOKENS. Increase maxOutputTokens or check your model/plan limits."
    );
    process.exit(1);
  }

  if (mode === "offer") {
    try {
      const jsonText = extractJsonBlock(text);
      const payload = JSON.parse(jsonText);
      if (!payload || (payload.decision !== "accept" && payload.decision !== "counter")) {
        throw new Error("Invalid decision field in response.");
      }
      if (typeof payload.message !== "string" || !payload.message.trim()) {
        throw new Error("Missing message in response.");
      }
      if (payload.decision === "counter") {
        if (payload.offer) {
          validateOffer(payload.offer, ISSUES);
        } else if (typeof payload.offer_compact === "string") {
          const parsedOffer = parseCompactOffer(payload.offer_compact);
          validateOffer(parsedOffer, ISSUES);
        } else {
          throw new Error("Missing offer or offer_compact in response.");
        }
      }
      console.log("Structured offer test: OK");
    } catch (error) {
      console.error("Structured offer test failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    console.log("Chat test: OK");
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});

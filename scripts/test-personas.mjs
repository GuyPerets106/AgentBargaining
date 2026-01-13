import fs from "fs";
import path from "path";

const PERSONA_TAGS = ["friendly-cooperative", "tough-businesslike", "curious-analytical"];
const DEFAULT_MODEL = "gemini-2.5-flash";
const ISSUES = [
  { key: "snacks", label: "Snack Packs", total: 8 },
  { key: "breaks", label: "Break Minutes", total: 10 },
  { key: "music", label: "Music Picks", total: 6 },
  { key: "tickets", label: "Prize Tickets", total: 8 },
];

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
  const parsed = { prompt: "", model: undefined };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") {
      parsed.model = args[i + 1];
      i += 1;
    } else if (!parsed.prompt && !arg.startsWith("--")) {
      parsed.prompt = arg;
    }
  }
  return parsed;
}

function normalizeModelName(name) {
  return name.replace(/^models\//, "");
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
  return Array.isArray(data.models) ? data.models : [];
}

function extractBestCandidate(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  if (candidates.length === 0) {
    return { text: "", finishReason: "unknown" };
  }
  const scored = candidates.map((candidate) => {
    const parts = candidate?.content?.parts ?? [];
    const partsText = parts.map((part) => part.text ?? "").join("");
    const contentText = candidate?.content?.text ?? "";
    const text = (partsText || contentText || "").trim();
    return { text, finishReason: candidate?.finishReason ?? "unknown" };
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

function offerToPlainText(offer) {
  return ISSUES.map((issue) => {
    const entry = offer[issue.key];
    return `${issue.label} (total ${issue.total}): Human ${entry.human}, Agent ${entry.agent}`;
  }).join(". ");
}

function formatWeights(weights) {
  const human = ISSUES.map(
    (issue) => `${issue.label}=${weights.human?.[issue.key] ?? 1}`
  ).join(", ");
  const agent = ISSUES.map(
    (issue) => `${issue.label}=${weights.agent?.[issue.key] ?? 1}`
  ).join(", ");
  return `Preference weights (points per unit). Human: ${human}. Agent: ${agent}.`;
}

function buildPrompt({ personaTag, offerText, humanQuestion, weights }) {
  const system =
    "You are a negotiation agent in a multi-issue bargaining game. Respond in 1 to 3 sentences. Do not output JSON or tables.";

  const issuesSummary = ISSUES.map(
    (issue) => `${issue.label} (${issue.key}) total ${issue.total}`
  ).join("; ");

  const userPrompt = [
    "Context: You are the agent in a multi-issue bargaining game. Your goal is to maximize your weighted utility.",
    "If no agreement is reached before the deadline or turn limit, both sides receive 0.",
    `Persona tag: ${personaTag} (neutral = concise, professional).`,
    `Issues and totals: ${issuesSummary}.`,
    formatWeights(weights),
    `Current agent offer: ${offerText}.`,
    "Last human offer: Snack Packs: Human 8 / Agent 0; Break Minutes: Human 2 / Agent 8; Music Picks: Human 3 / Agent 3; Prize Tickets: Human 2 / Agent 6.",
    `Recent chat: human: ${humanQuestion}`,
    "Deadline remaining: 180 seconds.",
    "Turn: 2 of 12.",
    "Respond in 1-2 sentences (max 40 words). Do not output JSON or tables.",
  ].join("\n");

  return { system, prompt: userPrompt };
}

async function callGemini({ model, system, prompt, apiKey, maxOutputTokens }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const best = extractBestCandidate(data);
  return best;
}

async function main() {
  loadEnvFile();
  const { prompt, model } = parseArgs();
  const weights = loadWeights();
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_AI_STUDIO_API_KEY. Set it in .env.local or the shell.");
    process.exit(1);
  }

  const models = await listModels(apiKey);
  const humanQuestion =
    prompt || "I want 8 snack packs. What do you want in return?";
  const resolvedModel = model || process.env.GOOGLE_AI_MODEL || DEFAULT_MODEL;
  const modelInfo = models.find(
    (entry) => normalizeModelName(entry.name) === normalizeModelName(resolvedModel)
  );
  const outputTokenLimit = modelInfo?.outputTokenLimit;
  const requestedMaxOutputTokens = 220000;
  const maxOutputTokens =
    typeof outputTokenLimit === "number"
      ? Math.min(requestedMaxOutputTokens, outputTokenLimit)
      : requestedMaxOutputTokens;
  const limitLine =
    typeof outputTokenLimit === "number"
      ? ` outputLimit=${outputTokenLimit}`
      : "";

  const offer = {
    snacks: { human: 6, agent: 2 },
    breaks: { human: 3, agent: 7 },
    music: { human: 4, agent: 2 },
    tickets: { human: 2, agent: 6 },
  };
  const offerText = offerToPlainText(offer);
  let hadError = false;

  for (const personaTag of PERSONA_TAGS) {
    const { system, prompt: personaPrompt } = buildPrompt({
      personaTag,
      offerText,
      humanQuestion,
      weights,
    });
    try {
      const result = await callGemini({
        model: resolvedModel,
        system,
        prompt: personaPrompt,
        apiKey,
        maxOutputTokens,
      });
      if (!result.text) {
        throw new Error("No text returned from Gemini.");
      }
      if (result.finishReason === "MAX_TOKENS") {
        throw new Error(
          `Gemini response hit MAX_TOKENS limit.${limitLine ? ` (${limitLine.trim()})` : ""}`
        );
      }
      console.log(`\n[${personaTag}]${limitLine}\n${result.text}`);
    } catch (error) {
      hadError = true;
      console.error(`\n[${personaTag}] ERROR:`, error instanceof Error ? error.message : error);
    }
  }

  if (hadError) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});

import { UTILITY_WEIGHTS } from "@/lib/config";
import type { Issue, Offer, OfferAllocation } from "@/lib/types";
import { computeUtilities, offerToPlainText, summarizeOffer } from "@/lib/utils";

const SYSTEM_PROMPT_CHAT =
  "You are a negotiation agent in a multi-issue bargaining game. Respond in 1 to 3 sentences. Do not output JSON or tables.";

const SYSTEM_PROMPT_OFFER =
  "You are a negotiation agent in a multi-issue bargaining game. Output JSON only. Do not include markdown, code fences, or any extra text.";

function formatWeightSummaryCompact(issues: Issue[]) {
  const human = issues
    .map((issue) => `${issue.key}=${UTILITY_WEIGHTS.human[issue.key] ?? 1}`)
    .join(",");
  const agent = issues
    .map((issue) => `${issue.key}=${UTILITY_WEIGHTS.agent[issue.key] ?? 1}`)
    .join(",");
  return `weights human{${human}} agent{${agent}}`;
}

function formatIssuesSummaryCompact(issues: Issue[]) {
  return issues.map((issue) => `${issue.key}=${issue.total}`).join(",");
}

function summarizeOfferByKey(offer: OfferAllocation, issues: Issue[]) {
  return issues
    .map((issue) => {
      const entry = offer[issue.key];
      if (!entry) return "";
      return `${issue.key} H${entry.human}/A${entry.agent}`;
    })
    .filter(Boolean)
    .join(", ");
}

type GeminiOfferDecision = {
  decision: "accept" | "counter";
  message: string;
  offer?: OfferAllocation;
};

function parseCompactOffer(text: string, issues: Issue[]) {
  const allocation: OfferAllocation = {};
  const normalized = text.replace(/\s+/g, "");
  const parts = normalized.split(",").filter(Boolean);
  const seen = new Set<string>();

  for (const part of parts) {
    const match = part.match(/^([a-zA-Z0-9_-]+)=H(\d+)\/A(\d+)$/);
    if (!match) {
      throw new Error(`Invalid compact offer segment "${part}".`);
    }
    const key = match[1];
    const human = Number.parseInt(match[2], 10);
    const agent = Number.parseInt(match[3], 10);
    if (Number.isNaN(human) || Number.isNaN(agent)) {
      throw new Error(`Invalid numeric values in compact offer "${part}".`);
    }
    if (human < 0 || agent < 0) {
      throw new Error(`Negative allocation in compact offer "${part}".`);
    }
    allocation[key] = { human, agent };
    seen.add(key);
  }

  issues.forEach((issue) => {
    const entry = allocation[issue.key];
    if (!entry || !seen.has(issue.key)) {
      throw new Error(`Compact offer missing issue "${issue.key}".`);
    }
    if (entry.human + entry.agent !== issue.total) {
      throw new Error(`Compact offer "${issue.key}" must sum to ${issue.total}.`);
    }
  });

  return allocation;
}

function extractJsonBlock(text: string) {
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
    throw new Error("Gemini response did not include a JSON object.");
  }
  return withoutFences.slice(start, end + 1);
}

function validateOfferAllocation(value: unknown, issues: Issue[]) {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini offer payload is missing or invalid.");
  }
  const raw = value as Record<string, { human?: number; agent?: number }>;
  const allocation: OfferAllocation = {};
  issues.forEach((issue) => {
    const entry = raw[issue.key];
    if (!entry) {
      throw new Error(`Offer missing allocation for issue "${issue.key}".`);
    }
    const human = entry.human;
    const agent = entry.agent;
    if (!Number.isInteger(human) || !Number.isInteger(agent)) {
      throw new Error(`Offer values for "${issue.key}" must be integers.`);
    }
    if (human < 0 || agent < 0) {
      throw new Error(`Offer values for "${issue.key}" must be non-negative.`);
    }
    if (human + agent !== issue.total) {
      throw new Error(
        `Offer values for "${issue.key}" must sum to ${issue.total}.`
      );
    }
    allocation[issue.key] = { human, agent };
  });
  return allocation;
}

export function parseGeminiOfferResponse(
  text: string,
  issues: Issue[]
): GeminiOfferDecision {
  const jsonBlock = extractJsonBlock(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    throw new Error("Gemini response was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini response must be a JSON object.");
  }
  const payload = parsed as Record<string, unknown>;
  const decision = payload.decision;
  const message = payload.message;
  if (decision !== "accept" && decision !== "counter") {
    throw new Error('Gemini decision must be "accept" or "counter".');
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("Gemini response must include a non-empty message.");
  }
  if (decision === "counter") {
    const offer =
      payload.offer !== undefined
        ? validateOfferAllocation(payload.offer, issues)
        : typeof payload.offer_compact === "string"
          ? parseCompactOffer(payload.offer_compact, issues)
          : undefined;
    if (!offer) {
      throw new Error("Gemini response missing counteroffer payload.");
    }
    return { decision, message: message.trim(), offer };
  }
  return { decision, message: message.trim() };
}

export function buildGeminiOfferPrompt(params: {
  personaTag?: string;
  issues: Issue[];
  humanOffer?: Offer | null;
  historySummary?: string;
  chatContext?: Array<{ role: string; content: string }>;
  deadlineRemaining?: number;
  turn?: number;
  maxTurns?: number;
}) {
  const weightsSummary = formatWeightSummaryCompact(params.issues);
  const issuesSummary = formatIssuesSummaryCompact(params.issues);
  const deadline = params.deadlineRemaining ? `deadline=${params.deadlineRemaining}s` : "";
  const turnInfo =
    params.turn && params.maxTurns ? `turn=${params.turn}/${params.maxTurns}` : "";
  const humanOffer = params.humanOffer?.allocation;
  const offerKeySummary = humanOffer
    ? summarizeOfferByKey(humanOffer, params.issues)
    : "none";

  const prompt = [
    "Role: negotiation agent. Goal: maximize agent utility. No deal by deadline/turn limit = 0.",
    `persona=${params.personaTag ?? "neutral"}`,
    `issues{${issuesSummary}}`,
    weightsSummary,
    `last_human_offer{${offerKeySummary}}`,
    deadline,
    turnInfo,
    "Decision: accept or counter.",
    "Offer rules: use issue keys; integers only; each issue sums to total.",
    "Output JSON only. Use compact offers to save tokens.",
    "{\"decision\":\"accept\"|\"counter\",\"message\":\"<=8 words\",\"offer_compact\":\"snacks=H6/A2,breaks=H3/A7,music=H4/A2,tickets=H2/A6\"}",
    "If you use offer (object) instead of offer_compact, it must use issue keys.",
    "Message must reference the offer (<=8 words). Output compact JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system: SYSTEM_PROMPT_OFFER, prompt };
}

export function buildGeminiChatPrompt(params: {
  personaTag?: string;
  issues: Issue[];
  currentOffer?: OfferAllocation | null;
  humanOffer?: Offer | null;
  historySummary?: string;
  chatContext?: Array<{ role: string; content: string }>;
  latestUserMessage?: string;
  deadlineRemaining?: number;
  turn?: number;
  maxTurns?: number;
}) {
  const weightsSummary = formatWeightSummaryCompact(params.issues);
  const issuesSummary = formatIssuesSummaryCompact(params.issues);
  const history = params.historySummary ? `history: ${params.historySummary}` : "";
  const chatContext = params.chatContext?.length
    ? `chat: ${params.chatContext
        .map((entry) => `${entry.role}:${entry.content}`)
        .join(" | ")}`
    : "";
  const deadline = params.deadlineRemaining ? `deadline=${params.deadlineRemaining}s` : "";
  const turnInfo =
    params.turn && params.maxTurns ? `turn=${params.turn}/${params.maxTurns}` : "";
  const currentOfferText = params.currentOffer
    ? offerToPlainText(params.currentOffer, params.issues)
    : "";

  const prompt = [
    "Role: negotiation agent. Goal: maximize agent utility. No deal by deadline/turn limit = 0.",
    `persona=${params.personaTag ?? "neutral"}`,
    `issues{${issuesSummary}}`,
    weightsSummary,
    currentOfferText ? `current_offer=${currentOfferText}` : "current_offer=none",
    params.humanOffer
      ? `last_human_offer=${summarizeOffer(params.humanOffer.allocation, params.issues)}`
      : "",
    params.latestUserMessage ? `latest_user_message=${params.latestUserMessage}` : "",
    history,
    chatContext,
    deadline,
    turnInfo,
    "Respond directly to the latest human message.",
    "Do not output a full allocation or numeric offer.",
    "You may mention which issues you value more and ask a clarifying question.",
    "Respond in 1-2 sentences (<=40 words). No JSON/tables.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system: SYSTEM_PROMPT_CHAT, prompt };
}

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>;
    text?: string;
  };
  finishReason?: string;
};

type GeminiResult = {
  text: string;
  finishReason?: string;
};

export function extractGeminiResult(data: unknown): GeminiResult {
  const candidates = (data as { candidates?: GeminiCandidate[] })?.candidates ?? [];
  if (candidates.length === 0) {
    return { text: "" };
  }

  const results = candidates.map((candidate) => {
    const parts = candidate.content?.parts ?? [];
    const partsText = parts.map((part) => part.text ?? "").join("");
    const contentText = candidate.content?.text ?? "";
    const text = (partsText || contentText || "").trim();
    return { text, finishReason: candidate.finishReason };
  });

  results.sort((a, b) => b.text.length - a.text.length);
  return results[0] ?? { text: "" };
}

export function extractGeminiText(data: unknown) {
  return extractGeminiResult(data).text;
}

export function isLikelyTruncated(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 12) return true;
  if (!/[.!?]$/.test(trimmed) && trimmed.length < 40) return true;
  return false;
}

export async function callGemini(
  system: string,
  prompt: string,
  options?: {
    temperature?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    failOnMaxTokens?: boolean;
    responseMimeType?: string;
  }
) {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_AI_STUDIO_API_KEY (check .env.local)");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 60000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const temperature = options?.temperature ?? 0.4;
  const maxOutputTokens = options?.maxOutputTokens ?? 320000;
  const responseMimeType = options?.responseMimeType;
  const failOnMaxTokens = options?.failOnMaxTokens ?? true;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens,
            ...(responseMimeType ? { responseMimeType } : {}),
          },
        }),
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const { text, finishReason } = extractGeminiResult(data);
    if (finishReason === "MAX_TOKENS" && failOnMaxTokens) {
      throw new Error("Gemini response hit MAX_TOKENS limit.");
    }
    return text;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini API request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  }
}

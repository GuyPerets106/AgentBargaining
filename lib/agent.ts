import { DEFAULT_DOMAIN, UTILITY_WEIGHTS } from "@/lib/config";
import type { Issue, Offer, OfferAllocation } from "@/lib/types";
import { offerToPlainText, summarizeOffer, computeUtilities } from "@/lib/utils";

const SYSTEM_PROMPT =
  "You are a negotiation chat assistant. You must not change numeric offer details. You only write a short message (1 to 3 sentences) framing the given offer. No tables, no JSON.";

/**
 * Generate a strategic agent offer based on:
 * 1. Agent's utility weights (prioritize issues the agent values)
 * 2. Concession level based on turn number (start aggressive, concede over time)
 * 3. Human's last offer (if available, try to improve on it for both sides)
 */
export function mockAgentOffer(
  turn: number,
  issues = DEFAULT_DOMAIN.issues,
  humanOffer?: Offer
): OfferAllocation {
  const weights = UTILITY_WEIGHTS;
  
  // Calculate agent's ideal allocation (take everything agent values most)
  // and minimum acceptable (Pareto-improving threshold)
  const agentIdeal: OfferAllocation = {};
  const fiftyFifty: OfferAllocation = {};
  
  issues.forEach((issue) => {
    // Agent's ideal: take all of high-value issues, give away low-value ones
    const agentWeight = weights.agent[issue.key] ?? 1;
    const humanWeight = weights.human[issue.key] ?? 1;
    
    // If agent values it more, agent wants it; otherwise give to human
    if (agentWeight > humanWeight) {
      agentIdeal[issue.key] = { human: 0, agent: issue.total };
    } else if (humanWeight > agentWeight) {
      agentIdeal[issue.key] = { human: issue.total, agent: 0 };
    } else {
      // Equal weights: split evenly
      const half = Math.floor(issue.total / 2);
      agentIdeal[issue.key] = { human: half, agent: issue.total - half };
    }
    
    // 50/50 baseline
    const half = Math.floor(issue.total / 2);
    fiftyFifty[issue.key] = { human: half, agent: issue.total - half };
  });
  
  // Concession rate: start at 0 (agent ideal), move toward 50/50 over turns
  // By turn 8, we're roughly at 50/50
  const concessionRate = Math.min(1, turn / 8);
  
  const allocation: OfferAllocation = {};
  issues.forEach((issue) => {
    const ideal = agentIdeal[issue.key];
    const baseline = fiftyFifty[issue.key];
    
    // Interpolate between ideal and 50/50 based on concession rate
    const agentShare = Math.round(
      ideal.agent * (1 - concessionRate) + baseline.agent * concessionRate
    );
    allocation[issue.key] = {
      human: issue.total - agentShare,
      agent: agentShare,
    };
  });
  
  // If human made an offer, check if we can do better for both sides
  if (humanOffer) {
    const humanOfferUtility = computeUtilities(humanOffer.allocation, weights);
    const ourOfferUtility = computeUtilities(allocation, weights);
    
    // If human's offer is actually better for the agent, consider accepting elements of it
    if (humanOfferUtility.agent > ourOfferUtility.agent * 0.9) {
      // Human's offer is close to or better than ours - make a counter that's
      // slightly better for human to encourage agreement
      issues.forEach((issue) => {
        const humanWants = humanOffer.allocation[issue.key]?.human ?? 0;
        const weOffer = allocation[issue.key].human;
        // Give human the better of what they asked or what we offered
        const giveHuman = Math.max(humanWants, weOffer);
        allocation[issue.key] = {
          human: Math.min(giveHuman, issue.total),
          agent: issue.total - Math.min(giveHuman, issue.total),
        };
      });
    }
  }
  
  return allocation;
}

/**
 * Generate a natural, conversational summary of an offer.
 * Instead of "Snack Packs (total 8): Human 7, Agent 1", say "I'd take 1 snack pack and you'd get 7"
 */
function naturalOfferSummary(allocation: OfferAllocation, issues: Issue[]): string {
  const parts: string[] = [];
  
  for (const issue of issues) {
    const split = allocation[issue.key];
    if (!split) continue;
    
    const label = issue.label.toLowerCase();
    if (split.agent === 0) {
      parts.push(`all ${issue.total} ${label} go to you`);
    } else if (split.human === 0) {
      parts.push(`I'd keep all ${issue.total} ${label}`);
    } else if (split.human > split.agent) {
      parts.push(`you get ${split.human} ${label}, I take ${split.agent}`);
    } else if (split.agent > split.human) {
      parts.push(`I'd take ${split.agent} ${label}, you get ${split.human}`);
    } else {
      parts.push(`we split ${label} evenly (${split.human} each)`);
    }
  }
  
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  
  const last = parts.pop();
  return `${parts.join(", ")}, and ${last}`;
}

// Variety of conversational openers and closers
const OFFER_OPENERS = [
  "Here's what I'm thinking:",
  "How about this:",
  "Let me suggest:",
  "I propose:",
  "What if we did this:",
  "Consider this offer:",
];

const OFFER_CLOSERS = [
  "What do you think?",
  "Does that work for you?",
  "I'm flexible if you want to adjust.",
  "Let me know your thoughts.",
  "Open to tweaks if needed.",
  "We can negotiate from here.",
];

const ACKNOWLEDGMENTS = [
  "Thanks for your proposal.",
  "I see what you're going for.",
  "Interesting offer.",
  "I appreciate the suggestion.",
  "Got it, let me think about that.",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildNeutralMessage(
  offerText: string,
  issues: Issue[],
  humanOffer?: Offer
) {
  const ack = humanOffer ? pickRandom(ACKNOWLEDGMENTS) : "";
  
  if (!offerText) {
    return `${ack} Could you propose specific numbers so I can respond?`.trim();
  }
  
  // Parse the offer from offerText if we need natural language
  // For now, just use conversational framing
  const opener = pickRandom(OFFER_OPENERS);
  const closer = pickRandom(OFFER_CLOSERS);
  
  return `${ack} ${opener} ${offerText}. ${closer}`.trim();
}

export function buildMockPersonaMessage(
  offerText: string, 
  personaTag?: string,
  allocation?: OfferAllocation,
  issues?: Issue[]
) {
  // Generate natural language summary if we have the allocation data
  const naturalSummary = allocation && issues 
    ? naturalOfferSummary(allocation, issues) 
    : offerText;
  
  if (!naturalSummary && !offerText) {
    return pickRandom([
      "Could you make a specific proposal? I'd like to respond to concrete numbers.",
      "What allocation did you have in mind? Share the details and I'll counter.",
      "I'm ready to negotiate - just need you to propose something specific.",
    ]);
  }
  
  const opener = pickRandom(OFFER_OPENERS);
  const closer = pickRandom(OFFER_CLOSERS);
  const summary = naturalSummary || offerText;
  
  return `${opener} ${summary}. ${closer}`;
}

export function buildGeminiPrompt(params: {
  personaTag?: string;
  offerAllocation?: OfferAllocation | null;
  issues: Issue[];
  humanOffer?: Offer;
  historySummary?: string;
  chatContext?: Array<{ role: string; content: string }>;
  deadlineRemaining?: number;
}) {
  const offerText = params.offerAllocation
    ? offerToPlainText(params.offerAllocation, params.issues)
    : "";
  const history = params.historySummary ? `History summary: ${params.historySummary}` : "";
  const chatContext = params.chatContext?.length
    ? `Recent chat: ${params.chatContext
        .map((entry) => `${entry.role}: ${entry.content}`)
        .join(" | ")}`
    : "";
  const deadline = params.deadlineRemaining
    ? `Deadline remaining: ${params.deadlineRemaining} seconds.`
    : "";

  const prompt = [
    `Persona tag: ${params.personaTag ?? "neutral"}.`,
    offerText ? `Current agent offer: ${offerText}.` : "No current offer on the table.",
    params.humanOffer
      ? `Last human offer: ${summarizeOffer(params.humanOffer.allocation, params.issues)}.`
      : "",
    history,
    chatContext,
    deadline,
    "Write the message now.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system: SYSTEM_PROMPT, prompt, offerText };
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

export async function callGemini(system: string, prompt: string) {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_AI_STUDIO_API_KEY (check .env.local)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

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
            temperature: 0.4,
            maxOutputTokens: 240,
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
    if (finishReason === "MAX_TOKENS") {
      console.warn("Gemini response hit MAX_TOKENS limit.");
    }
    return text;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini API request timed out after 15 seconds");
    }
    throw error;
  }
}

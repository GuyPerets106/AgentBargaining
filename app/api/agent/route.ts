import { NextResponse } from "next/server";

import { DEFAULT_DOMAIN } from "@/lib/config";
import type { Offer } from "@/lib/types";
import {
  buildGeminiOfferPrompt,
  buildGeminiOfferRepairPrompt,
  buildFallbackOfferAllocation,
  callGemini,
  parseGeminiOfferResponse,
} from "@/lib/agent";

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;

function checkRateLimit(sessionId: string) {
  const now = Date.now();
  const entry = rateLimits.get(sessionId);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(sessionId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  entry.count += 1;
  return true;
}


export async function POST(req: Request) {
  try {
    let body: {
      session_id?: string;
      condition_id?: "neutral" | "persona";
      persona_tag?: string;
      last_human_offer?: Offer;
      turn?: number;
      history_summary?: string;
      decision_summary?: string;
      deadline_remaining?: number;
      chat_context?: Array<{ role: string; content: string }>;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const sessionId = body.session_id ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    if (!checkRateLimit(sessionId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const issues = DEFAULT_DOMAIN.issues;
    const personaTag = body.condition_id === "persona" ? body.persona_tag : "neutral";
    const fallbackResponse = (reason?: string) => {
      if (reason) {
        console.warn(`[agent] using fallback offer: ${reason}`);
      }
      const fallbackOffer = buildFallbackOfferAllocation(issues);
      return NextResponse.json({
        agent_message: "Counteroffer based on priorities.",
        agent_offer: fallbackOffer,
        decision: "counter",
        model: "local-fallback",
      });
    };
    const { system, prompt } = buildGeminiOfferPrompt({
      personaTag,
      issues,
      humanOffer: body.last_human_offer ?? null,
      historySummary: body.history_summary,
      decisionSummary: body.decision_summary,
      chatContext: body.chat_context,
      deadlineRemaining: body.deadline_remaining,
      turn: body.turn,
      maxTurns: DEFAULT_DOMAIN.max_turns,
    });

    let raw = "";
    let model = "unknown";
    try {
      const result = await callGemini(system, prompt, {
        temperature: 0.3,
        maxOutputTokens: 700000,
        responseMimeType: "application/json",
      });
      raw = result.text;
      model = result.model;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Gemini error";
      return fallbackResponse(message);
    }
    let parsed;
    let parsedModel = model;
    try {
      parsed = parseGeminiOfferResponse(raw, issues);
    } catch (error) {
      const repair = buildGeminiOfferRepairPrompt({
        personaTag,
        issues,
        humanOffer: body.last_human_offer ?? null,
        historySummary: body.history_summary,
        decisionSummary: body.decision_summary,
        chatContext: body.chat_context,
        deadlineRemaining: body.deadline_remaining,
        turn: body.turn,
        maxTurns: DEFAULT_DOMAIN.max_turns,
        errorMessage: error instanceof Error ? error.message : "Unknown parse error",
        rawResponse: raw,
      });
      try {
        const repairResult = await callGemini(repair.system, repair.prompt, {
          temperature: 0.2,
          maxOutputTokens: 700000,
          responseMimeType: "application/json",
        });
        parsedModel = repairResult.model;
        parsed = parseGeminiOfferResponse(repairResult.text, issues);
      } catch {
        return fallbackResponse("Repair attempt failed");
      }
    }

    if (parsed.decision === "accept") {
      if (!body.last_human_offer) {
        return fallbackResponse("Accept without human offer");
      }
      return NextResponse.json({
        agent_message: parsed.message,
        decision: "accept",
        model: parsedModel,
      });
    }

    return NextResponse.json({
      agent_message: parsed.message,
      agent_offer: parsed.offer,
      decision: "counter",
      model: parsedModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[agent] unexpected error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { DEFAULT_DOMAIN } from "@/lib/config";
import type { Offer } from "@/lib/types";
import {
  buildGeminiOfferPrompt,
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
    const body = (await req.json()) as {
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

    const sessionId = body.session_id ?? "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    if (!checkRateLimit(sessionId)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const issues = DEFAULT_DOMAIN.issues;
    const personaTag = body.condition_id === "persona" ? body.persona_tag : "neutral";
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

    const raw = await callGemini(system, prompt, {
      temperature: 0.3,
      maxOutputTokens: 700000,
      responseMimeType: "application/json",
    });
    const parsed = parseGeminiOfferResponse(raw, issues);

    if (parsed.decision === "accept") {
      if (!body.last_human_offer) {
        return NextResponse.json(
          { error: "Agent accepted but no human offer was provided." },
          { status: 400 }
        );
      }
      return NextResponse.json({
        agent_message: parsed.message,
        decision: "accept",
      });
    }

    return NextResponse.json({
      agent_message: parsed.message,
      agent_offer: parsed.offer,
      decision: "counter",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

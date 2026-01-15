import { NextResponse } from "next/server";

import { DEFAULT_DOMAIN } from "@/lib/config";
import type { Offer, OfferAllocation } from "@/lib/types";
import {
  buildGeminiChatPrompt,
  callGemini,
} from "@/lib/agent";

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
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
      current_offer?: OfferAllocation | null;
      last_human_offer?: Offer;
      turn?: number;
      history_summary?: string;
      deadline_remaining?: number;
      chat_context?: Array<{ role: string; content: string }>;
      latest_user_message?: string;
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
    const { system, prompt } = buildGeminiChatPrompt({
      personaTag,
      issues,
      currentOffer: body.current_offer ?? null,
      humanOffer: body.last_human_offer ?? null,
      historySummary: body.history_summary,
      chatContext: body.chat_context,
      latestUserMessage: body.latest_user_message,
      deadlineRemaining: body.deadline_remaining,
      turn: body.turn,
      maxTurns: DEFAULT_DOMAIN.max_turns,
    });
    const agentMessage = (
      await callGemini(system, prompt, {
        temperature: 0.3,
        maxOutputTokens: 320000,
      })
    ).trim();
    if (!agentMessage) {
      throw new Error("Gemini returned an empty response.");
    }

    return NextResponse.json({ agent_message: agentMessage });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

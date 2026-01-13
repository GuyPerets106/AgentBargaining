import { NextResponse } from "next/server";

import { DEFAULT_DOMAIN } from "@/lib/config";
import type { Offer, OfferAllocation } from "@/lib/types";
import { offerToPlainText } from "@/lib/utils";
import {
  buildGeminiPrompt,
  buildMockPersonaMessage,
  buildNeutralMessage,
  callGemini,
  isLikelyTruncated,
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
      history_summary?: string;
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
    const offerAllocation = body.current_offer ?? null;
    const offerText = offerAllocation ? offerToPlainText(offerAllocation, issues) : "";

    const mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

    let agentMessage = "";
    if (body.condition_id === "persona" && !mockMode) {
      const { system, prompt } = buildGeminiPrompt({
        personaTag: body.persona_tag,
        offerAllocation,
        issues,
        humanOffer: body.last_human_offer,
        historySummary: body.history_summary,
        chatContext: body.chat_context,
        deadlineRemaining: body.deadline_remaining,
      });
      agentMessage = (await callGemini(system, prompt)).trim();
    } else if (body.condition_id === "persona" && mockMode) {
      agentMessage = buildMockPersonaMessage(offerText, body.persona_tag, offerAllocation, issues);
    } else {
      agentMessage = buildNeutralMessage(offerText, issues, body.last_human_offer);
    }

    if (!agentMessage || isLikelyTruncated(agentMessage)) {
      agentMessage =
        body.condition_id === "persona"
          ? buildMockPersonaMessage(offerText, body.persona_tag, offerAllocation, issues)
          : buildNeutralMessage(offerText, issues, body.last_human_offer);
    }

    return NextResponse.json({ agent_message: agentMessage });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

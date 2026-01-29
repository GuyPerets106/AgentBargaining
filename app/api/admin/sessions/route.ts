import { NextResponse } from "next/server";
import { listStoredSessions } from "@/lib/server/sessionStore";

export async function GET() {
  try {
    const stored = await listStoredSessions();
    const sessions = stored.map(({ filename, stored_at, session }) => ({
      filename,
      stored_at,
      session_id: session.session_id,
      created_at: session.created_at,
      condition_id: session.condition.id,
      participant_id: session.participant.participant_id,
      outcome_reason: session.outcome.reason ?? null,
      turns: session.outcome.turns,
      duration_seconds: session.outcome.duration_seconds,
    }));

    return NextResponse.json({ ok: true, sessions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

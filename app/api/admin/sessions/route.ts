import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import type { ExperimentSession } from "@/lib/types";

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "data");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    const sessions = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join(dir, filename);
        const [raw, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
        const data = JSON.parse(raw) as ExperimentSession;
        return {
          filename,
          stored_at: stats.mtime.toISOString(),
          session_id: data.session_id,
          created_at: data.created_at,
          condition_id: data.condition.id,
          participant_id: data.participant.participant_id,
          outcome_reason: data.outcome.reason ?? null,
          turns: data.outcome.turns,
          duration_seconds: data.outcome.duration_seconds,
        };
      })
    );

    sessions.sort((a, b) => (a.stored_at < b.stored_at ? 1 : -1));

    return NextResponse.json({ ok: true, sessions });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

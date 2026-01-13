import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import type { ExperimentSession } from "@/lib/types";

const inMemoryStore: ExperimentSession[] = [];

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as ExperimentSession;
    const dir = path.join(process.cwd(), "data");
    const filename = `session-${payload.session_id}-${Date.now()}.json`;

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), JSON.stringify(payload, null, 2));
      return NextResponse.json({ ok: true, stored_as: filename });
    } catch {
      inMemoryStore.push(payload);
      return NextResponse.json({ ok: true, stored_as: "memory-fallback" });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

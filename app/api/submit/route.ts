import { NextResponse } from "next/server";
import type { ExperimentSession } from "@/lib/types";
import { storeSession } from "@/lib/server/sessionStore";

const inMemoryStore: ExperimentSession[] = [];

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as ExperimentSession;
    try {
      const result = await storeSession(payload);
      return NextResponse.json({
        ok: true,
        stored_as: result.stored_as,
        storage: result.storage,
        warning: result.warning,
      });
    } catch (error) {
      inMemoryStore.push(payload);
      return NextResponse.json({
        ok: true,
        stored_as: "memory-fallback",
        warning: error instanceof Error ? error.message : "Store failed",
      });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

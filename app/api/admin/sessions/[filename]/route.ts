import { NextResponse } from "next/server";
import { readStoredSession } from "@/lib/server/sessionStore";

export async function GET(
  _req: Request,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    const { raw } = await readStoredSession(filename);

    return new NextResponse(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename=${filename}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 404 }
    );
  }
}

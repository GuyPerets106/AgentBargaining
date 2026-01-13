import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

function safeFilename(input: string) {
  const base = path.basename(input);
  if (base !== input) return null;
  if (!base.endsWith(".json")) return null;
  if (base.includes("..")) return null;
  return base;
}

export async function GET(
  _req: Request,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = safeFilename(params.filename);
    if (!filename) {
      return NextResponse.json({ ok: false, error: "Invalid filename" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "data", filename);
    const raw = await fs.readFile(filePath, "utf8");

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

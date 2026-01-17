import { NextResponse } from "next/server";

import { callGemini } from "@/lib/agent";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      system?: string;
      temperature?: number;
      maxTokens?: number;
    };

    const prompt = body.prompt ?? "";
    const system = body.system ?? "";
    const { text, model } = await callGemini(system, prompt, {
      temperature: body.temperature ?? 0.4,
      maxOutputTokens: body.maxTokens ?? 120000,
    });

    return NextResponse.json({ text, model });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

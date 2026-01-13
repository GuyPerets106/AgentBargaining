import { NextResponse } from "next/server";

import { extractGeminiText } from "@/lib/agent";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      system?: string;
      temperature?: number;
      maxTokens?: number;
    };

    const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_AI_STUDIO_API_KEY" },
        { status: 500 }
      );
    }

    const prompt = body.prompt ?? "";
    const system = body.system ?? "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          ],
          generationConfig: {
            temperature: body.temperature ?? 0.4,
            maxOutputTokens: body.maxTokens ?? 120000,
          },
        }),
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Gemini request failed", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    const text = extractGeminiText(data);

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

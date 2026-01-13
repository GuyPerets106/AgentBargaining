import fs from "fs";
import path from "path";

const PERSONA_TAGS = ["friendly-cooperative", "tough-businesslike", "curious-analytical"];
const DEFAULT_MODEL = "gemini-2.5-flash";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { prompt: "", model: undefined };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") {
      parsed.model = args[i + 1];
      i += 1;
    } else if (!parsed.prompt && !arg.startsWith("--")) {
      parsed.prompt = arg;
    }
  }
  return parsed;
}

function offerToPlainText(offer) {
  return [
    `Snack Packs (total 8): Human ${offer.snacks.human}, Agent ${offer.snacks.agent}`,
    `Break Minutes (total 10): Human ${offer.breaks.human}, Agent ${offer.breaks.agent}`,
    `Music Picks (total 6): Human ${offer.music.human}, Agent ${offer.music.agent}`,
    `Prize Tickets (total 8): Human ${offer.tickets.human}, Agent ${offer.tickets.agent}`,
  ].join(". ");
}

function buildPrompt({ personaTag, offerText, humanQuestion }) {
  const system =
    "You are a negotiation chat assistant. You must not change numeric offer details. You only write a short message (1 to 3 sentences) framing the given offer. No tables, no JSON.";

  const userPrompt = [
    `Persona tag: ${personaTag}.`,
    `Current agent offer: ${offerText}.`,
    "Last human offer: Snack Packs: Human 8 / Agent 0; Break Minutes: Human 2 / Agent 8; Music Picks: Human 3 / Agent 3; Prize Tickets: Human 2 / Agent 6.",
    `Recent chat: human: ${humanQuestion}`,
    "Deadline remaining: 180 seconds.",
    "Write the message now.",
  ].join("\n");

  return { system, prompt: userPrompt };
}

async function callGemini({ model, system, prompt, apiKey }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 220,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const partsText = parts.map((part) => part.text ?? "").join("");
  const contentText = data?.candidates?.[0]?.content?.text ?? "";
  return (partsText || contentText || "").trim();
}

async function main() {
  loadEnvFile();
  const { prompt, model } = parseArgs();
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_AI_STUDIO_API_KEY. Set it in .env.local or the shell.");
    process.exit(1);
  }

  const humanQuestion =
    prompt || "I want 8 snack packs. What do you want in return?";
  const resolvedModel = model || process.env.GOOGLE_AI_MODEL || DEFAULT_MODEL;

  const offer = {
    snacks: { human: 6, agent: 2 },
    breaks: { human: 3, agent: 7 },
    music: { human: 4, agent: 2 },
    tickets: { human: 2, agent: 6 },
  };
  const offerText = offerToPlainText(offer);

  for (const personaTag of PERSONA_TAGS) {
    const { system, prompt: personaPrompt } = buildPrompt({
      personaTag,
      offerText,
      humanQuestion,
    });
    try {
      const text = await callGemini({
        model: resolvedModel,
        system,
        prompt: personaPrompt,
        apiKey,
      });
      console.log(`\n[${personaTag}]\n${text || "(no text returned)"}`);
    } catch (error) {
      console.error(`\n[${personaTag}] ERROR:`, error instanceof Error ? error.message : error);
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});

import fs from "fs";
import path from "path";

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
  const parsed = { model: undefined, prompt: undefined, list: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") {
      parsed.model = args[i + 1];
      i += 1;
    } else if (arg === "--prompt") {
      parsed.prompt = args[i + 1];
      i += 1;
    } else if (arg === "--list") {
      parsed.list = true;
    } else if (!parsed.prompt && !arg.startsWith("--")) {
      parsed.prompt = arg;
    }
  }
  return parsed;
}

async function listModels(apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ListModels failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const models = Array.isArray(data.models) ? data.models : [];
  return models;
}

function normalizeModelName(name) {
  return name.replace(/^models\//, "");
}

function pickDefaultModel(models) {
  const supported = models.filter((model) =>
    (model.supportedGenerationMethods || []).includes("generateContent")
  );
  if (supported.length === 0) return null;

  const candidates = ["gemini-2.5-flash"];

  for (const candidate of candidates) {
    const match = supported.find(
      (model) => normalizeModelName(model.name) === candidate
    );
    if (match) return match.name;
  }

  return supported[0].name;
}

async function main() {
  loadEnvFile();
  const { model: argModel, prompt, list } = parseArgs();
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_AI_STUDIO_API_KEY. Set it in .env.local or the shell.");
    process.exit(1);
  }

  const envModel = process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL;
  let model = argModel || envModel;

  const models = await listModels(apiKey);

  if (list) {
    const available = models
      .filter((entry) => (entry.supportedGenerationMethods || []).includes("generateContent"))
      .map((entry) => normalizeModelName(entry.name));
    console.log("Models supporting generateContent:");
    available.forEach((name) => console.log(`- ${name}`));
    return;
  }

  if (!model) {
    model = pickDefaultModel(models);
  }

  if (!model) {
    console.error("No models found that support generateContent.");
    process.exit(1);
  }

  const modelName = model.startsWith("models/") ? model : `models/${model}`;
  const resolvedPrompt = prompt ?? "Say hello in one short sentence.";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: resolvedPrompt }] }],
        systemInstruction: { parts: [{ text: "Respond with a single short sentence." }] },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 60,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Request failed (${response.status}): ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  const candidates = data?.candidates ?? [];
  const parts = candidates?.[0]?.content?.parts ?? [];
  const partsText = parts.map((part) => part.text ?? "").join("");
  const contentText = candidates?.[0]?.content?.text ?? "";
  const text = (partsText || contentText || "").trim();
  if (!text) {
    console.error("No text returned from Gemini.");
    process.exit(1);
  }

  console.log(`Gemini OK (${normalizeModelName(modelName)}):`, text.trim());
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});

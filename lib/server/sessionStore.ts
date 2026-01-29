import "server-only";

import { Storage } from "@google-cloud/storage";
import { promises as fs } from "fs";
import path from "path";

import type { ExperimentSession } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const bucketName = process.env.SESSION_BUCKET_NAME;
const prefixRaw = process.env.SESSION_BUCKET_PREFIX ?? "sessions";
const normalizedPrefix = prefixRaw.replace(/^\/+|\/+$/g, "");
const objectPrefix = normalizedPrefix ? `${normalizedPrefix}/` : "";

let storage: Storage | null = null;

function getBucket() {
  if (!bucketName) return null;
  if (!storage) {
    storage = new Storage();
  }
  return storage.bucket(bucketName);
}

function safeFilename(input: string) {
  const base = path.basename(input);
  if (base !== input) return null;
  if (!base.endsWith(".json")) return null;
  if (base.includes("..")) return null;
  return base;
}

export type StoredSessionEntry = {
  filename: string;
  stored_at: string;
  session: ExperimentSession;
  source: "gcs" | "local";
  objectKey?: string;
};

export type StoredSessionResult = {
  stored_as: string;
  storage: "gcs" | "local";
  warning?: string;
};

export async function storeSession(payload: ExperimentSession): Promise<StoredSessionResult> {
  const filename = `session-${payload.session_id}-${Date.now()}.json`;
  const raw = JSON.stringify(payload, null, 2);
  const bucket = getBucket();

  if (bucket) {
    try {
      const objectName = `${objectPrefix}${filename}`;
      await bucket.file(objectName).save(raw, {
        contentType: "application/json",
      });
      return { stored_as: filename, storage: "gcs" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown GCS error";
      console.warn(`[sessionStore] GCS write failed, falling back to local: ${message}`);
    }
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, filename), raw);
  return { stored_as: filename, storage: "local" };
}

export async function listStoredSessions(): Promise<StoredSessionEntry[]> {
  const bucket = getBucket();
  if (bucket) {
    const [files] = await bucket.getFiles({ prefix: objectPrefix });
    const jsonFiles = files.filter((file) => file.name.endsWith(".json"));
    const sessions = await Promise.all(
      jsonFiles.map(async (file) => {
        const [contents] = await file.download();
        const data = JSON.parse(contents.toString("utf8")) as ExperimentSession;
        const filename = path.posix.basename(file.name);
        const storedAt =
          file.metadata.updated ?? file.metadata.timeCreated ?? new Date().toISOString();
        return {
          filename,
          stored_at: new Date(storedAt).toISOString(),
          session: data,
          source: "gcs" as const,
          objectKey: file.name,
        };
      })
    );
    sessions.sort((a, b) => (a.stored_at < b.stored_at ? 1 : -1));
    return sessions;
  }

  let entries: Array<import("fs").Dirent> = [];
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);

  const sessions = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(dataDir, filename);
      const [raw, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
      const data = JSON.parse(raw) as ExperimentSession;
      return {
        filename,
        stored_at: stats.mtime.toISOString(),
        session: data,
        source: "local" as const,
      };
    })
  );

  sessions.sort((a, b) => (a.stored_at < b.stored_at ? 1 : -1));
  return sessions;
}

export async function readStoredSession(filenameInput: string) {
  const filename = safeFilename(filenameInput);
  if (!filename) {
    throw new Error("Invalid filename");
  }
  const bucket = getBucket();
  if (bucket) {
    const objectName = `${objectPrefix}${filename}`;
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error("Session not found");
    }
    const [contents] = await file.download();
    return { raw: contents.toString("utf8"), storage: "gcs" as const };
  }

  const filePath = path.join(dataDir, filename);
  const raw = await fs.readFile(filePath, "utf8");
  return { raw, storage: "local" as const };
}

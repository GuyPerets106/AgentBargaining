"use client";

import { useEffect, useState } from "react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { usePageView } from "@/hooks/usePageView";
import { cn } from "@/lib/utils";

type AdminSession = {
  filename: string;
  stored_at: string;
  session_id: string;
  created_at: string;
  condition_id: string;
  participant_id: string;
  outcome_reason: string | null;
  turns: number;
  duration_seconds: number;
};

export default function AdminPage() {
  usePageView("/admin");
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/sessions");
      if (!response.ok) {
        throw new Error(`Load failed: ${response.status}`);
      }
      const data = (await response.json()) as { ok: boolean; sessions: AdminSession[] };
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const handleDownload = async (filename: string) => {
    setDownloading(filename);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sessions/${encodeURIComponent(filename)}`);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <LayoutShell className="max-w-5xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Admin: Session Logs</CardTitle>
          <CardDescription>
            Sessions saved locally in <span className="font-mono">data/</span> are listed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {loading ? "Loading sessions..." : `${sessions.length} session(s) found.`}
            </div>
            <Button variant="outline" onClick={loadSessions} disabled={loading}>
              Refresh List
            </Button>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Separator />

          <div className="space-y-4">
            {sessions.length === 0 && !loading ? (
              <div className="text-sm text-muted-foreground">No sessions saved yet.</div>
            ) : null}
            {sessions.map((session) => (
              <div
                key={session.filename}
                className="grid gap-3 rounded-xl border border-border/60 bg-background/70 p-4 md:grid-cols-[1.2fr_1fr_0.7fr_0.6fr]"
              >
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Session</div>
                  <div className="font-mono text-xs text-foreground">{session.session_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Saved {new Date(session.stored_at).toLocaleString()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Participant</div>
                  <div className="text-sm font-semibold text-foreground">
                    {session.participant_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Condition: {session.condition_id}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Outcome</div>
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      session.outcome_reason === "agreement"
                        ? "text-emerald-600"
                        : "text-amber-600"
                    )}
                  >
                    {session.outcome_reason ?? "incomplete"}
                  </div>
                  <div className="text-xs text-muted-foreground">Turns: {session.turns}</div>
                </div>
                <div className="flex items-center justify-start md:justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => handleDownload(session.filename)}
                    disabled={downloading === session.filename}
                  >
                    {downloading === session.filename ? "Downloading..." : "Download JSON"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

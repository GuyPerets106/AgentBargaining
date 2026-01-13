"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, RefreshCw, XCircle } from "lucide-react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadJson } from "@/lib/utils";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

export default function DonePage() {
  usePageView("/done");
  const router = useRouter();
  const { session, submission, resetSession, setSubmission, addEvent } = useSessionStore();
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [autoSubmitAttempted, setAutoSubmitAttempted] = useState(false);

  useEffect(() => {
    const submitIfNeeded = async () => {
      if (!session || submission?.ok || autoSubmitAttempted) return;
      setAutoSubmitAttempted(true);
      setAutoSubmitting(true);
      try {
        const response = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(session),
        });
        if (!response.ok) {
          throw new Error(`Submit failed: ${response.status}`);
        }
        const data = (await response.json()) as { ok: boolean; stored_as?: string };
        setSubmission({ ok: true, stored_as: data.stored_as });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        addEvent("error", { source: "submit", message });
        setSubmission({ ok: false, error: message });
      } finally {
        setAutoSubmitting(false);
      }
    };

    void submitIfNeeded();
  }, [addEvent, autoSubmitAttempted, session, setSubmission, submission?.ok]);

  if (!session) {
    return (
      <LayoutShell>
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle>Session not found</CardTitle>
            <CardDescription>Return to the landing page to start a new session.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/")}>Go Home</Button>
          </CardContent>
        </Card>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell className="max-w-4xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Session Complete</CardTitle>
          <CardDescription>Thank you for participating in the negotiation study.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Session ID</div>
              <div className="mt-2 font-mono text-sm text-foreground">{session.session_id}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Participant ID</div>
              <div className="mt-2 font-mono text-sm text-foreground">
                {session.participant.participant_id}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {submission?.ok ? (
                <CheckCircle2 className="h-4 w-4 text-accent" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              {submission?.ok ? "Logs submitted" : "Submission incomplete"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {submission?.ok
                ? `Stored as ${submission?.stored_as ?? "session file"}.`
                : "Download the JSON log and share it with your instructor."}
            </p>
            {autoSubmitting ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Attempting to save this session automatically...
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => downloadJson(`session-${session.session_id}.json`, session)}
            >
              <Download className="h-4 w-4" />
              Download Logs
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                resetSession();
                router.push("/");
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Start New Session
            </Button>
          </div>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

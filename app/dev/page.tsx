"use client";

import { useRouter } from "next/navigation";
import { FlaskConical, Play, RefreshCw } from "lucide-react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERSONA_TAGS } from "@/lib/config";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

export default function DevPage() {
  usePageView("/dev");
  const router = useRouter();
  const { initSession, startNegotiation, resetSession } = useSessionStore();

  const quickStart = (condition: "neutral" | "persona") => {
    initSession(condition, condition === "persona" ? PERSONA_TAGS[0] : undefined);
    startNegotiation();
    router.push("/negotiate");
  };

  return (
    <LayoutShell className="max-w-3xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-accent" />
            Dev Utilities
          </CardTitle>
          <CardDescription>Quickly spin up sessions for testing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={() => quickStart("neutral")} size="lg">
              <Play className="h-4 w-4" />
              Start Neutral Session
            </Button>
            <Button onClick={() => quickStart("persona")} size="lg" variant="secondary">
              <Play className="h-4 w-4" />
              Start Persona Session
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              resetSession();
              router.push("/");
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Reset Session
          </Button>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

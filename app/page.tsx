"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PERSONA_TAGS } from "@/lib/config";
import { useSessionStore } from "@/store/useSessionStore";
import type { ConditionId } from "@/lib/types";
import { usePageView } from "@/hooks/usePageView";

export default function HomePage() {
  usePageView("/");
  const router = useRouter();
  const { session, initSession, resetSession, updateParticipant } = useSessionStore();
  const [condition, setCondition] = useState<ConditionId>("neutral");
  const [personaTag, setPersonaTag] = useState<string>(PERSONA_TAGS[0]);
  const [experimentCode, setExperimentCode] = useState("");

  const hasActiveSession = useMemo(() => {
    return session && !session.outcome.reason;
  }, [session]);

  const startSession = () => {
    initSession(condition, condition === "persona" ? personaTag : undefined);
    if (experimentCode.trim()) {
      updateParticipant({ notes: `code:${experimentCode.trim()}` });
    }
    router.push("/consent");
  };

  return (
    <LayoutShell>
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="space-y-4">
            <Badge variant="secondary" className="w-fit gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Multi-issue negotiation experiment
            </Badge>
            <h1 className="text-4xl font-semibold text-foreground">
              Run a fast, data-rich negotiation session in minutes.
            </h1>
            <p className="text-base text-muted-foreground">
              Collect consent, demographics, structured offers, chat exchanges, and survey data with a
              streamlined, classroom-ready workflow.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Condition Control</CardTitle>
                <CardDescription>Switch between neutral or persona framing.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={condition} onValueChange={(value) => setCondition(value as ConditionId)}>
                  <TabsList className="w-full">
                    <TabsTrigger value="neutral" className="flex-1">
                      Neutral
                    </TabsTrigger>
                    <TabsTrigger value="persona" className="flex-1">
                      Persona
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="neutral">
                    <p className="text-sm text-muted-foreground">
                      Templated, consistent language across all sessions.
                    </p>
                  </TabsContent>
                  <TabsContent value="persona" className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Gemini generates framing with the selected persona tag.
                    </p>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Persona tag
                      </label>
                      <select
                        className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm"
                        value={personaTag}
                        onChange={(event) => setPersonaTag(event.target.value)}
                      >
                        {PERSONA_TAGS.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Session Code</CardTitle>
                <CardDescription>Optional classroom or cohort code.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Enter code"
                  value={experimentCode}
                  onChange={(event) => setExperimentCode(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stored anonymously to help organize datasets.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        <Card className="glass-panel h-fit">
          <CardHeader>
            <CardTitle className="text-xl">Start the experiment</CardTitle>
            <CardDescription>Ideal for 6-minute classroom demonstrations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasActiveSession ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-background/60 px-3 py-2 text-sm text-muted-foreground">
                You have an active session in progress.
              </div>
            ) : null}
            <Button className="w-full" size="lg" onClick={startSession}>
              Begin New Session
            </Button>
            {hasActiveSession ? (
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => router.push("/instructions")}
              >
                Resume Session
              </Button>
            ) : null}
            {session ? (
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => {
                  resetSession();
                }}
              >
                Clear Saved Session
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}

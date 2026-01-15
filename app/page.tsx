"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PERSONA_TAGS } from "@/lib/config";
import { useSessionStore } from "@/store/useSessionStore";
import type { ConditionId } from "@/lib/types";
import { usePageView } from "@/hooks/usePageView";
import { cn } from "@/lib/utils";

export default function HomePage() {
  usePageView("/");
  const router = useRouter();
  const { initSession } = useSessionStore();
  const [selectedPersona, setSelectedPersona] = useState<string>("neutral");

  const startSession = () => {
    const condition: ConditionId = selectedPersona === "neutral" ? "neutral" : "persona";
    initSession(condition, condition === "persona" ? selectedPersona : undefined);
    router.push("/consent");
  };

  const personaOptions = [
    {
      id: "neutral",
      label: "Neutral",
      description: "Baseline agent tone for controlled comparisons.",
    },
    ...PERSONA_TAGS.map((tag) => ({
      id: tag,
      label: tag
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      description: `Persona: ${tag}`,
    })),
  ];

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
              Launch a negotiation session with the persona you want to test.
            </h1>
            <p className="text-base text-muted-foreground">
              Each participant starts a fresh session, so multiple people can negotiate in parallel
              on different devices or browsers.
            </p>
          </div>
        </div>
        <Card className="glass-panel h-fit">
          <CardHeader>
            <CardTitle className="text-xl">Choose agent persona</CardTitle>
            <CardDescription>Select the tone before starting a new session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {personaOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedPersona(option.id)}
                className={cn(
                  "w-full rounded-2xl border-2 px-4 py-3 text-left transition-all",
                  "bg-background/70 hover:border-primary/70 hover:bg-white/85",
                  selectedPersona === option.id
                    ? "border-primary bg-primary/10 shadow-soft ring-2 ring-primary/30"
                    : "border-border/70"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{option.label}</span>
                  <span
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.18em]",
                      selectedPersona === option.id ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {selectedPersona === option.id ? "Selected" : "Select"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
              </button>
            ))}
            <Button className="mt-4 w-full" size="lg" onClick={startSession}>
              Begin New Session
            </Button>
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Sparkle, Star, Timer as TimerIcon } from "lucide-react";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UTILITY_WEIGHTS } from "@/lib/config";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

export default function InstructionsPage() {
  usePageView("/instructions");
  const router = useRouter();
  const { session, startNegotiation, addEvent } = useSessionStore();

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const handleStart = () => {
    startNegotiation();
    addEvent("instruction_ack", { acknowledged: true });
    router.push("/negotiate");
  };

  if (!session) return null;

  const exampleOffer = session.config.issues.map((issue) => {
    const human = Math.ceil(issue.total * 0.6);
    return {
      key: issue.key,
      label: issue.label,
      human,
      agent: issue.total - human,
    };
  });

  return (
    <LayoutShell className="max-w-4xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Instructions</CardTitle>
          <CardDescription>Read this summary before starting the negotiation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="issues">
            <TabsList>
              <TabsTrigger value="issues">What You Negotiate</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
              <TabsTrigger value="offers">Offers</TabsTrigger>
              <TabsTrigger value="timing">Timing</TabsTrigger>
            </TabsList>
            <TabsContent value="issues" className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                Scenario: You and the agent are splitting simple classroom perks for a group
                activity (snacks, break time, music picks, prize tickets). The agent wants more
                perks for itself; you want more for your side.
              </div>
              
              {/* KEY: Show asymmetric preferences to motivate trading */}
              <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary mb-3">
                  <Star className="h-4 w-4" />
                  Your Point Values (Important!)
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Different items are worth different amounts to you. <strong>Focus on getting more of what YOU value most!</strong>
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {session.config.issues.map((issue) => {
                    const weight = UTILITY_WEIGHTS.human[issue.key] ?? 1;
                    const stars = "★".repeat(weight) + "☆".repeat(4 - weight);
                    return (
                      <div
                        key={issue.key}
                        className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{issue.label}</span>
                        <span className="text-amber-500 font-mono">{stars} ({weight} pts/unit)</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  💡 Tip: The agent has <em>different</em> preferences. Trading items you value less 
                  for items you value more can make you <em>both</em> better off than a 50/50 split!
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                Your score = Σ (units you receive × point value). If no agreement is reached, 
                your score is 0. Maximize your total points while reaching agreement!
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {session.config.issues.map((issue) => (
                  <div
                    key={issue.key}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-background/70 px-4 py-3 text-sm"
                  >
                    <span className="font-semibold text-foreground">{issue.label}</span>
                    <span className="text-xs text-muted-foreground">{issue.total} units total</span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                There is no predetermined “correct” amount. You decide how much you want from each
                issue, and the agent will counter with its own preferences.
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                Research context: this is a standard multi-issue bargaining task used to study
                tradeoffs, concessions, and communication under time pressure.
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Example offer
                </div>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {exampleOffer.map((issue) => (
                    <div key={issue.key} className="flex items-center justify-between">
                      <span>{issue.label}</span>
                      <span>
                        You {issue.human} / Agent {issue.agent}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="rules" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Make proposals and negotiate.
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    You can propose offers and chat with the agent. Offers are structured by issue.
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkle className="h-4 w-4 text-accent" />
                    Keep it concise.
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Short messages make it easier for the agent to respond during class.
                  </p>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="offers" className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                Each issue has a fixed number of units to allocate between you and the agent. The
                offer builder ensures totals remain valid.
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                You can accept the agent&apos;s last offer or propose a counteroffer. Agreement ends
                when you accept an offer.
              </div>
            </TabsContent>
            <TabsContent value="timing" className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                <TimerIcon className="h-4 w-4 text-muted-foreground" />
                Deadline: {Math.round(session.config.deadline_seconds / 60)} minutes
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                Negotiation ends on agreement, timeout, or max turns ({session.config.max_turns}).
              </div>
            </TabsContent>
          </Tabs>

          <Separator />

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Ready? You can begin immediately and adjust offers as needed.
            </div>
            <Button size="lg" onClick={handleStart}>
              Start Negotiation
            </Button>
          </div>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import LayoutShell from "@/components/LayoutShell";
import SurveyForm, { type SurveyValues } from "@/components/SurveyForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_DOMAIN, UTILITY_WEIGHTS } from "@/lib/config";
import { computeUtilities, nowIso } from "@/lib/utils";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

export default function SurveyPage() {
  usePageView("/survey");
  const router = useRouter();
  const { toast } = useToast();
  const { session, attachSurvey, setSubmission, addEvent } = useSessionStore();

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const handleSubmit = async (values: SurveyValues) => {
    if (!session) return;
    const surveyPayload = {
      t: nowIso(),
      fairness: values.fairness,
      trust: values.trust,
      cooperativeness: values.cooperativeness,
      human_likeness: values.human_likeness,
      satisfaction: values.satisfaction,
      negotiate_again: values.negotiate_again,
      comment: values.comment?.trim() || undefined,
    };
    attachSurvey(surveyPayload);

    const submissionPayload = {
      ...session,
      survey: surveyPayload,
    };

    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionPayload),
      });
      if (!response.ok) {
        throw new Error(`Submit failed: ${response.status}`);
      }
      const data = (await response.json()) as { ok: boolean; stored_as?: string };
      setSubmission({ ok: true, stored_as: data.stored_as });
      toast({
        title: "Session saved",
        description: "Your responses have been recorded.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addEvent("error", { source: "submit", message });
      setSubmission({
        ok: false,
        error: message,
      });
      toast({
        title: "Submission failed",
        description: "You can download logs on the next screen.",
        variant: "destructive",
      });
    } finally {
      router.push("/done");
    }
  };

  const issues = session?.config.issues ?? DEFAULT_DOMAIN.issues;
  const agreedOffer = session?.outcome.agreed_offer;
  const allocationForDisplay = useMemo(() => {
    if (agreedOffer?.allocation) {
      return agreedOffer.allocation;
    }
    return issues.reduce((acc, issue) => {
      acc[issue.key] = { human: 0, agent: 0 };
      return acc;
    }, {} as Record<string, { human: number; agent: number }>);
  }, [agreedOffer, issues]);
  const totals = useMemo(() => {
    return issues.reduce(
      (acc, issue) => {
        const allocation = allocationForDisplay[issue.key];
        acc.human += allocation?.human ?? 0;
        acc.agent += allocation?.agent ?? 0;
        acc.total += issue.total;
        return acc;
      },
      { human: 0, agent: 0, total: 0 }
    );
  }, [allocationForDisplay, issues]);
  const points = agreedOffer?.allocation
    ? computeUtilities(agreedOffer.allocation, UTILITY_WEIGHTS)
    : { human: 0, agent: 0, joint: 0 };
  const pieData = [
    { name: "You", value: totals.human },
    { name: "Agent", value: totals.agent },
  ];
  const outcomeLabel =
    session?.outcome.reason === "agreement"
      ? "Agreement reached"
      : session?.outcome.reason === "timeout"
      ? "Timed out"
      : session?.outcome.reason === "turn_limit"
      ? "Turn limit reached"
      : session?.outcome.reason === "abort"
      ? "Session aborted"
      : "Session ended";
  const acceptanceLabel = useMemo(() => {
    if (!session) return "No offer was accepted";
    if (session.outcome.reason !== "agreement") {
      return "No offer was accepted";
    }
    const acceptEvent = [...session.events].reverse().find((event) => event.type === "offer_accept");
    const by = (acceptEvent?.payload as { by?: string } | undefined)?.by;
    if (by === "human") return "Offer accepted by you";
    if (by === "agent") return "Offer accepted by the agent";
    return "Offer accepted";
  }, [session]);

  if (!session) return null;

  return (
    <LayoutShell className="max-w-5xl">
      <div className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Game Result</CardTitle>
              <CardDescription>{outcomeLabel}</CardDescription>
              <div
                className={
                  acceptanceLabel === "No offer was accepted"
                    ? "text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
                    : "text-xs font-semibold uppercase tracking-[0.2em] text-primary"
                }
              >
                {acceptanceLabel}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={125}
                      paddingAngle={2}
                    >
                      <Cell fill="#0ea5e9" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} units`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    Total Units
                  </div>
                  <div className="text-3xl font-semibold text-foreground">{totals.total}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    You {totals.human} · Agent {totals.agent}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Your points
                  </div>
                  <div className="text-2xl font-semibold text-foreground">{points.human}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Agent points
                  </div>
                  <div className="text-2xl font-semibold text-foreground">{points.agent}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Joint points
                  </div>
                  <div className="text-2xl font-semibold text-foreground">{points.joint}</div>
                </div>
              </div>
              {session.outcome.reason !== "agreement" ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  No agreement reached. Points are 0.
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Allocation & Points</CardTitle>
              <CardDescription>Units and weighted points by issue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <span>Issue</span>
                <span className="text-right">You</span>
                <span className="text-right">Agent</span>
              </div>
              <div className="space-y-2">
                {issues.map((issue) => {
                  const allocation = allocationForDisplay[issue.key];
                  const humanWeight = UTILITY_WEIGHTS.human[issue.key] ?? 1;
                  const agentWeight = UTILITY_WEIGHTS.agent[issue.key] ?? 1;
                  const humanPoints = (allocation?.human ?? 0) * humanWeight;
                  const agentPoints = (allocation?.agent ?? 0) * agentWeight;
                  return (
                    <div
                      key={issue.key}
                      className="grid grid-cols-[1.4fr_0.8fr_0.8fr] items-center rounded-xl border border-border/60 bg-background/70 px-3 py-2"
                    >
                      <div className="text-sm font-semibold text-foreground">{issue.label}</div>
                      <div className="text-right text-xs text-primary">
                        {allocation?.human ?? 0} units · {humanPoints} pts
                      </div>
                      <div className="text-right text-xs text-amber-700">
                        {allocation?.agent ?? 0} units · {agentPoints} pts
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
        <SurveyForm onSubmit={handleSubmit} />
      </div>
    </LayoutShell>
  );
}

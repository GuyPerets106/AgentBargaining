"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, MessageCircle, ThumbsUp } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import ChatPanel from "@/components/ChatPanel";
import ConditionBadge from "@/components/ConditionBadge";
import LayoutShell from "@/components/LayoutShell";
import OfferBuilder from "@/components/OfferBuilder";
import OfferHistory from "@/components/OfferHistory";
import Timer from "@/components/Timer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { DEFAULT_DOMAIN, UTILITY_WEIGHTS } from "@/lib/config";
import type { Offer } from "@/lib/types";
import { allocationFromIssues, computeUtilities, nowIso, summarizeHistory, summarizeDecisions } from "@/lib/utils";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

const ISSUE_PALETTE = ["#0ea5e9", "#22d3ee", "#10b981", "#f97316", "#6366f1", "#f59e0b"];

export default function NegotiatePage() {
  usePageView("/negotiate");
  const router = useRouter();
  const { toast } = useToast();
  const {
    session,
    offers,
    chat,
    draftOffer,
    setCurrentOfferDraft,
    pushOffer,
    pushChat,
    addEvent,
    isAwaitingAgent,
    setAwaitingAgent,
    deadlineEndsAt,
    startNegotiation,
    endSession,
  } = useSessionStore();

  const issues = session?.config.issues ?? DEFAULT_DOMAIN.issues;

  const [abortOpen, setAbortOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace("/");
      return;
    }
    startNegotiation();
    if (!draftOffer) {
      setCurrentOfferDraft(allocationFromIssues(issues, "equal"));
    }
  }, [draftOffer, issues, router, session, setCurrentOfferDraft, startNegotiation]);

  const currentAgentOffer = useMemo(
    () => [...offers].reverse().find((offer) => offer.by === "agent"),
    [offers]
  );

  const lastHumanOffer = useMemo(
    () => [...offers].reverse().find((offer) => offer.by === "human"),
    [offers]
  );

  const decisionSummary = useMemo(() => {
    if (!session) return "";
    return summarizeDecisions(session.events, 10);
  }, [session]);

  const offerIsValid = useMemo(() => {
    if (!draftOffer) return false;
    return issues.every((issue) => {
      const entry = draftOffer[issue.key];
      return entry && entry.human + entry.agent === issue.total && entry.human >= 0;
    });
  }, [draftOffer, issues]);

  const deadlineRemaining = useMemo(() => {
    if (!deadlineEndsAt) return 0;
    return Math.max(0, Math.floor((Date.parse(deadlineEndsAt) - Date.now()) / 1000));
  }, [deadlineEndsAt]);

  const completeSession = useCallback(
    (reason: "agreement" | "timeout" | "turn_limit" | "abort", agreedOffer?: Offer) => {
      if (!session) return;
      const finalOffer = reason === "agreement" ? agreedOffer ?? currentAgentOffer : undefined;
      const utilities = finalOffer
        ? computeUtilities(finalOffer.allocation, UTILITY_WEIGHTS)
        : undefined;
      endSession({ reason, agreedOffer: finalOffer, utilities });
      addEvent("end", { reason, agreed_offer: finalOffer });
      if (reason === "abort") {
        router.push("/done");
      } else {
        router.push("/survey");
      }
    },
    [addEvent, currentAgentOffer, endSession, router, session]
  );

  useEffect(() => {
    if (!session || session.outcome.reason) return;
    if (offers.length >= session.config.max_turns) {
      completeSession("turn_limit");
    }
  }, [completeSession, offers.length, session]);

  const handlePropose = async () => {
    if (!session || !draftOffer) return;
    if (!offerIsValid) {
      toast({
        title: "Invalid offer",
        description: "Each issue must allocate all units between you and the agent.",
        variant: "destructive",
      });
      return;
    }

    const nextTurn = offers.length + 1;
    const offer: Offer = {
      turn: nextTurn,
      by: "human",
      allocation: draftOffer,
      created_at: nowIso(),
    };
    pushOffer(offer);
    addEvent("offer_propose", { offer });

    setAwaitingAgent(true);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.session_id,
          condition_id: session.condition.id,
          persona_tag: session.condition.persona_tag,
          last_human_offer: offer,
          turn: nextTurn,
          history_summary: summarizeHistory([...offers, offer], session.config.max_turns),
          decision_summary: decisionSummary,
          deadline_remaining: deadlineRemaining,
          chat_context: chat.slice(-12).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          typeof errorBody?.error === "string"
            ? errorBody.error
            : `Agent response failed: ${response.status}`;
        throw new Error(errorMessage);
      }
      const data = (await response.json()) as {
        agent_message: string;
        agent_offer?: Offer["allocation"];
        decision?: "accept" | "counter";
        model?: string;
      };

      if (data.decision === "accept") {
        pushChat({ role: "agent", content: data.agent_message });
        addEvent("chat_receive", {
          content: data.agent_message,
          turn: offer.turn,
          model: data.model,
        });
        addEvent("offer_accept", { offer, by: "agent", model: data.model });
        completeSession("agreement", offer);
        return;
      }

      if (!data.agent_offer) {
        throw new Error("Agent did not return a counteroffer.");
      }

      const agentOffer: Offer = {
        turn: nextTurn + 1,
        by: "agent",
        allocation: data.agent_offer,
        created_at: nowIso(),
      };

      pushOffer(agentOffer);
      addEvent("offer_receive", { offer: agentOffer, model: data.model });
      pushChat({ role: "agent", content: data.agent_message });
      addEvent("chat_receive", {
        content: data.agent_message,
        turn: agentOffer.turn,
        model: data.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addEvent("error", { source: "agent", message });
      toast({
        title: "Agent error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAwaitingAgent(false);
    }
  };

  const handleAccept = () => {
    if (!currentAgentOffer) {
      toast({
        title: "No offer to accept",
        description: "Wait for the agent to respond first.",
        variant: "destructive",
      });
      return;
    }
    addEvent("offer_accept", { offer: currentAgentOffer, by: "human" });
    completeSession("agreement", currentAgentOffer);
  };

  const handleChatSend = async (message: string) => {
    if (!session) return;
    pushChat({ role: "human", content: message });
    addEvent("chat_send", { content: message });

    setAwaitingAgent(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.session_id,
          condition_id: session.condition.id,
          persona_tag: session.condition.persona_tag,
          current_offer: currentAgentOffer?.allocation ?? null,
          last_human_offer: lastHumanOffer ?? null,
          turn: offers.length,
          history_summary: summarizeHistory(offers, session.config.max_turns),
          decision_summary: decisionSummary,
          deadline_remaining: deadlineRemaining,
          chat_context: [...chat, { role: "human", content: message }].slice(-12),
          latest_user_message: message,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          typeof errorBody?.error === "string"
            ? errorBody.error
            : `Chat response failed: ${response.status}`;
        throw new Error(errorMessage);
      }
      const data = (await response.json()) as { agent_message: string; model?: string };
      pushChat({ role: "agent", content: data.agent_message });
      addEvent("chat_receive", {
        content: data.agent_message,
        source: "chat",
        model: data.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addEvent("error", { source: "chat", message });
      toast({
        title: "Chat error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAwaitingAgent(false);
    }
  };

  if (!session) return null;

  const buildOfferSummary = useCallback(
    (offer?: Offer | null) => {
      if (!offer) return null;
      const totals = issues.reduce(
        (acc, issue) => {
          const allocation = offer.allocation?.[issue.key] ?? { human: 0, agent: 0 };
          acc.human += allocation.human;
          acc.agent += allocation.agent;
          acc.total += issue.total;
          return acc;
        },
        { human: 0, agent: 0, total: 0 }
      );
      const utilities = computeUtilities(offer.allocation, UTILITY_WEIGHTS);
      const issueRows = issues.map((issue, index) => {
        const allocation = offer.allocation?.[issue.key] ?? { human: 0, agent: 0 };
        const humanPoints = allocation.human * (UTILITY_WEIGHTS.human[issue.key] ?? 1);
        const agentPoints = allocation.agent * (UTILITY_WEIGHTS.agent[issue.key] ?? 1);
        return {
          issue,
          allocation,
          humanPoints,
          agentPoints,
          color: ISSUE_PALETTE[index % ISSUE_PALETTE.length],
        };
      });
      const pieData = [
        { name: "You", value: totals.human },
        { name: "Agent", value: totals.agent },
      ];
      return { offer, totals, utilities, issueRows, pieData };
    },
    [issues]
  );

  const agentOfferSummary = useMemo(
    () => buildOfferSummary(currentAgentOffer),
    [buildOfferSummary, currentAgentOffer]
  );
  const humanOfferSummary = useMemo(
    () => buildOfferSummary(lastHumanOffer),
    [buildOfferSummary, lastHumanOffer]
  );

  const preferenceWeightsCard = (
    <Card className="glass-panel">
      <CardHeader>
        <CardTitle className="text-lg">Preference Weights</CardTitle>
        <CardDescription>Higher points per unit = higher priority.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-[1.3fr_0.8fr_0.8fr] text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <span>Issue</span>
          <span className="text-right">You</span>
          <span className="text-right">Agent</span>
        </div>
        <div className="space-y-2">
          {issues.map((issue, index) => (
            <div
              key={issue.key}
              className="grid grid-cols-[1.3fr_0.8fr_0.8fr] items-center rounded-xl border border-border/60 bg-background/70 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: ISSUE_PALETTE[index % ISSUE_PALETTE.length] }}
                />
                <span className="text-sm font-semibold text-foreground">{issue.label}</span>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                  {UTILITY_WEIGHTS.human[issue.key] ?? 1} pts
                </span>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                  {UTILITY_WEIGHTS.agent[issue.key] ?? 1} pts
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <LayoutShell className="max-w-none lg:w-[96%] xl:w-[98%] lg:pr-56">
      <div className="fixed bottom-4 right-4 z-40 flex w-[min(220px,80vw)] flex-col gap-3 lg:bottom-6 lg:right-6">
        <Dialog open={abortOpen} onOpenChange={setAbortOpen}>
          <DialogTrigger asChild>
            <Button
              size="lg"
              className="w-full gap-2 bg-red-600 text-white shadow-lg ring-1 ring-red-500/50 hover:bg-red-700"
              disabled={isAwaitingAgent}
            >
              <AlertTriangle className="h-4 w-4" />
              Abort Session
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abort this session?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will end the negotiation and mark the session as aborted.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAbortOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setAbortOpen(false);
                  completeSession("abort");
                }}
              >
                Confirm Abort
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="rounded-2xl border border-slate-300/80 bg-white px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-slate-900">ID {session.participant.participant_id}</span>
            <span className="h-4 w-px bg-slate-200" />
            <ConditionBadge condition={session.condition.id} />
          </div>
          {session.condition.persona_tag ? (
            <div className="mt-2 text-[10px] font-semibold tracking-[0.12em] text-slate-800">
              {session.condition.persona_tag}
            </div>
          ) : null}
        </div>
      </div>
      <div className="fixed right-4 top-20 z-50 flex w-64 max-w-[90vw] flex-col gap-4 md:top-24">
        <Timer
          endsAt={deadlineEndsAt}
          onExpire={() => {
            addEvent("timer_tick", { remaining: 0 });
            completeSession("timeout");
          }}
        />
        <Card className="glass-panel border border-border/60">
          <CardContent className="space-y-3 pt-6 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Turn
              </span>
              <span className="text-lg font-semibold text-foreground">
                {offers.length}/{session?.config.max_turns ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Proposals Left
              </span>
              <span className="text-lg font-semibold text-foreground">
                {Math.max(0, (session?.config.max_turns ?? 0) - offers.length)}
              </span>
            </div>
          </CardContent>
        </Card>
        <div className="max-h-[60vh] overflow-auto">{preferenceWeightsCard}</div>
      </div>
      <div className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(640px,1fr)_minmax(640px,960px)]">
          <div className="flex flex-col gap-6">
            {draftOffer ? (
              <OfferBuilder
                issues={issues}
                draft={draftOffer}
                disabled={isAwaitingAgent}
                onChange={setCurrentOfferDraft}
                onPropose={handlePropose}
                proposeDisabled={!offerIsValid || isAwaitingAgent}
                isProposing={isAwaitingAgent}
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-6">
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-lg">Offer Summary</CardTitle>
                <CardDescription>Latest offers from you and the agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-6 xl:grid-cols-2">
                  {[
                    {
                      label: "Your last offer",
                      summary: humanOfferSummary,
                      empty: "No human offer yet.",
                    },
                    {
                      label: "Agent last offer",
                      summary: agentOfferSummary,
                      empty: "Waiting for the agent's first offer.",
                    },
                  ].map(({ label, summary, empty }) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-border/60 bg-background/70 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-foreground">{label}</div>
                        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Turn {summary?.offer?.turn ?? "—"}
                        </div>
                      </div>
                      {summary ? (
                        <div className="mt-4 space-y-4">
                          <div className="relative h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={summary.pieData}
                                  dataKey="value"
                                  nameKey="name"
                                  innerRadius={70}
                                  outerRadius={120}
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
                              <div className="text-3xl font-semibold text-foreground">
                                {summary.totals.total}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                You {summary.totals.human} · Agent {summary.totals.agent}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                Your points
                              </div>
                              <div className="text-2xl font-semibold text-foreground">
                                {summary.utilities?.human ?? "—"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                Agent points
                              </div>
                              <div className="text-2xl font-semibold text-foreground">
                                {summary.utilities?.agent ?? "—"}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                              <span>Issue</span>
                              <span className="text-right">You</span>
                              <span className="text-right">Agent</span>
                            </div>
                            {summary.issueRows.map((row) => (
                              <div
                                key={row.issue.key}
                                className="grid grid-cols-[1.2fr_1fr_1fr] items-center rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: row.color }}
                                  />
                                  <span className="font-semibold text-foreground">
                                    {row.issue.label}
                                  </span>
                                </div>
                                <div className="text-right text-sm">
                                  <span className="font-semibold text-sky-700">
                                    {row.allocation.human}
                                  </span>{" "}
                                  units ·{" "}
                                  <span className="font-semibold text-sky-900">
                                    {row.humanPoints}
                                  </span>{" "}
                                  pts
                                </div>
                                <div className="text-right text-sm">
                                  <span className="font-semibold text-amber-700">
                                    {row.allocation.agent}
                                  </span>{" "}
                                  units ·{" "}
                                  <span className="font-semibold text-amber-900">
                                    {row.agentPoints}
                                  </span>{" "}
                                  pts
                                </div>
                              </div>
                            ))}
                          </div>
                          {label === "Agent last offer" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="lg"
                                className="h-14 bg-emerald-600 px-8 text-lg text-white shadow-lg hover:bg-emerald-700"
                                onClick={handleAccept}
                                disabled={!currentAgentOffer || isAwaitingAgent}
                              >
                                <ThumbsUp className="h-5 w-5" />
                                Accept Offer
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/30 text-sm text-muted-foreground">
                          {empty}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <OfferHistory offers={offers} issues={issues} />
        <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2">
          {chatOpen ? (
            <ChatPanel
              messages={chat}
              onSend={handleChatSend}
              disabled={isAwaitingAgent}
              isAwaiting={isAwaitingAgent}
              onCollapse={() => setChatOpen(false)}
              className="h-[460px] w-[min(420px,92vw)]"
            />
          ) : (
            <Button
              type="button"
              size="lg"
              className="gap-2 rounded-full bg-slate-900 px-5 text-white shadow-lg hover:bg-slate-800"
              onClick={() => setChatOpen(true)}
            >
              <MessageCircle className="h-4 w-4" />
              Open Chat
            </Button>
          )}
        </div>
        <Separator className="my-8" />
        <Card className="glass-panel">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Turn Support</CardTitle>
              <CardDescription>Quick reminders for classroom pacing.</CardDescription>
            </div>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
              Offer builder prevents invalid allocations.
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
              Agent message arrives after each proposal.
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
              Negotiation ends automatically at deadline.
            </div>
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}

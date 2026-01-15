"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import ChatPanel from "@/components/ChatPanel";
import ConditionBadge from "@/components/ConditionBadge";
import LayoutShell from "@/components/LayoutShell";
import NegotiationLayout from "@/components/NegotiationLayout";
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
import {
  allocationFromIssues,
  cn,
  computeUtilities,
  nowIso,
  summarizeHistory,
  summarizeOffer,
} from "@/lib/utils";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

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
          history_summary: summarizeHistory([...offers, offer]),
          deadline_remaining: deadlineRemaining,
          chat_context: chat.slice(-4).map((message) => ({
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
      };

      if (data.decision === "accept") {
        pushChat({ role: "agent", content: data.agent_message });
        addEvent("chat_receive", { content: data.agent_message, turn: offer.turn });
        addEvent("offer_accept", { offer, by: "agent" });
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
      addEvent("offer_receive", { offer: agentOffer });
      pushChat({ role: "agent", content: data.agent_message });
      addEvent("chat_receive", { content: data.agent_message, turn: agentOffer.turn });
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

  const handleReject = () => {
    if (!currentAgentOffer) {
      toast({
        title: "No offer to reject",
        description: "Wait for the agent to respond first.",
        variant: "destructive",
      });
      return;
    }
    addEvent("offer_reject", { offer: currentAgentOffer });
    toast({
      title: "Offer rejected",
      description: "Adjust your offer and propose a counteroffer.",
    });
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
          history_summary: summarizeHistory(offers),
          deadline_remaining: deadlineRemaining,
          chat_context: [...chat, { role: "human", content: message }].slice(-4),
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
      const data = (await response.json()) as { agent_message: string };
      pushChat({ role: "agent", content: data.agent_message });
      addEvent("chat_receive", { content: data.agent_message, source: "chat" });
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

  const currentUtilities = currentAgentOffer ? computeUtilities(currentAgentOffer.allocation, UTILITY_WEIGHTS) : null;

  return (
    <LayoutShell className="max-w-none">
      <NegotiationLayout
        left={
          <>
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Session Status</CardTitle>
                <CardDescription>Track time, turns, and condition.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Condition</span>
                  <ConditionBadge condition={session.condition.id} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Turn</span>
                  <span className="font-semibold">
                    {offers.length}/{session.config.max_turns}
                  </span>
                </div>
                {/* Prominent turns remaining indicator */}
                <div className={cn(
                  "rounded-lg p-3 text-center",
                  session.config.max_turns - offers.length <= 2
                    ? "bg-destructive/10 border-2 border-destructive/50"
                    : session.config.max_turns - offers.length <= 4
                    ? "bg-amber-500/10 border-2 border-amber-500/50"
                    : "bg-muted/50 border border-border"
                )}>
                  <div className={cn(
                    "text-2xl font-bold",
                    session.config.max_turns - offers.length <= 2
                      ? "text-destructive"
                      : session.config.max_turns - offers.length <= 4
                      ? "text-amber-600"
                      : "text-foreground"
                  )}>
                    {session.config.max_turns - offers.length}
                  </div>
                  <div className="text-xs text-muted-foreground">proposals left</div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Participant ID</span>
                  <span className="font-mono text-xs">{session.participant.participant_id}</span>
                </div>
              </CardContent>
            </Card>
            <div className="lg:sticky lg:top-24">
              <Timer
                endsAt={deadlineEndsAt}
                onExpire={() => {
                  addEvent("timer_tick", { remaining: 0 });
                  completeSession("timeout");
                }}
              />
            </div>
            <Card className="glass-panel lg:sticky lg:bottom-6">
              <CardHeader>
                <CardTitle className="text-base">Offer Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {currentAgentOffer ? (
                  <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                    {summarizeOffer(currentAgentOffer.allocation, issues)}
                  </div>
                ) : (
                  <div>No agent offer yet.</div>
                )}
                {currentUtilities ? (
                  <div className="grid gap-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span>Your weighted points (if accepted)</span>
                      <span className="font-semibold text-foreground">{currentUtilities.human}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Agent weighted points</span>
                      <span className="font-semibold text-foreground">{currentUtilities.agent}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Weights shown below. No agreement = 0.
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Preference Weights</CardTitle>
                <CardDescription>Higher weight = more important.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {issues.map((issue) => (
                  <div
                    key={issue.key}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <span className="font-semibold text-foreground">{issue.label}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                        You {UTILITY_WEIGHTS.human[issue.key] ?? 1}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                        Agent {UTILITY_WEIGHTS.agent[issue.key] ?? 1}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        }
        center={
          <>
            {currentAgentOffer ? (
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle className="text-base">Current Agent Offer</CardTitle>
                  <CardDescription>Review the latest allocation by issue.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 rounded-xl border border-border/60 bg-background/70 p-4 text-sm">
                    {issues.map((issue) => {
                      const allocation = currentAgentOffer.allocation[issue.key];
                      if (!allocation) return null;
                      return (
                        <div
                          key={issue.key}
                          className="flex items-center justify-between rounded-lg border border-border/50 bg-white/70 px-3 py-2"
                        >
                          <div className="font-semibold text-foreground">{issue.label}</div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                              You {allocation.human}
                            </span>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                              Agent {allocation.agent}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={handleAccept} disabled={isAwaitingAgent}>
                      <ThumbsUp className="h-4 w-4" />
                      Accept Offer
                    </Button>
                    <Button variant="outline" onClick={handleReject} disabled={isAwaitingAgent}>
                      <ThumbsDown className="h-4 w-4" />
                      Reject / Counter
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {draftOffer ? (
              <OfferBuilder
                issues={issues}
                draft={draftOffer}
                disabled={isAwaitingAgent}
                onChange={setCurrentOfferDraft}
              />
            ) : null}
            <Card className="glass-panel">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handlePropose}
                  disabled={!offerIsValid || isAwaitingAgent}
                >
                  {isAwaitingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Propose Offer
                </Button>
                <Dialog open={abortOpen} onOpenChange={setAbortOpen}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="w-full" disabled={isAwaitingAgent}>
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
              </CardContent>
            </Card>
          </>
        }
        right={
          <ChatPanel
            messages={chat}
            onSend={handleChatSend}
            disabled={isAwaitingAgent}
            isAwaiting={isAwaitingAgent}
          />
        }
        bottom={<OfferHistory offers={offers} issues={issues} />}
      />
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
    </LayoutShell>
  );
}

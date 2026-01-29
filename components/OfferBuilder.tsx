"use client";

import { Loader2, Minus, Plus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { UTILITY_WEIGHTS } from "@/lib/config";
import type { Issue, OfferAllocation } from "@/lib/types";
import { clamp, computeUtilities } from "@/lib/utils";

export default function OfferBuilder({
  issues,
  draft,
  onChange,
  disabled,
  onPropose,
  proposeDisabled,
  isProposing,
}: {
  issues: Issue[];
  draft: OfferAllocation;
  onChange: (allocation: OfferAllocation) => void;
  disabled?: boolean;
  onPropose?: () => void;
  proposeDisabled?: boolean;
  isProposing?: boolean;
}) {
  const totals = issues.reduce(
    (acc, issue) => {
      const allocation = draft[issue.key] ?? { human: 0, agent: issue.total };
      acc.human += allocation.human;
      acc.agent += allocation.agent;
      acc.total += issue.total;
      return acc;
    },
    { human: 0, agent: 0, total: 0 }
  );
  const utilities = computeUtilities(draft, UTILITY_WEIGHTS);

  const updateIssue = (issue: Issue, humanValue: number) => {
    const clamped = clamp(humanValue, 0, issue.total);
    const next: OfferAllocation = { ...draft };
    next[issue.key] = { human: clamped, agent: issue.total - clamped };
    onChange(next);
  };

  return (
    <Card className="glass-panel">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Build Your Offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700 whitespace-nowrap">
                Your Current Offer Outcome
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-amber-200/70 bg-white/80 px-3 py-2">
                  <div className="text-xs uppercase text-sky-700">You</div>
                  <div className="text-base font-semibold text-foreground">
                    {totals.human} units · {utilities.human} pts
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200/70 bg-white/80 px-3 py-2">
                  <div className="text-xs uppercase text-amber-700">Agent</div>
                  <div className="text-base font-semibold text-foreground">
                    {totals.agent} units · {utilities.agent} pts
                  </div>
                </div>
              </div>
              <div className="text-xs text-amber-800">Total units in pool: {totals.total}</div>
            </div>
            {onPropose ? (
              <Button
                type="button"
                size="lg"
                className="h-12 gap-2 bg-orange-500 px-6 text-base text-white shadow-lg transition-transform hover:bg-orange-600 active:scale-[0.98]"
                onClick={onPropose}
                disabled={disabled || proposeDisabled}
              >
                {isProposing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Propose Offer
              </Button>
            ) : null}
          </div>
        </div>
        {issues.map((issue) => {
          const allocation = draft[issue.key] ?? { human: 0, agent: issue.total };
          const humanWeight = UTILITY_WEIGHTS.human[issue.key] ?? 1;
          const agentWeight = UTILITY_WEIGHTS.agent[issue.key] ?? 1;
          const humanPoints = allocation.human * humanWeight;
          const agentPoints = allocation.agent * agentWeight;
          return (
            <div key={issue.key} className="rounded-xl border border-border/60 bg-background/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{issue.label}</div>
                  <div className="text-xs text-muted-foreground">Total units: {issue.total}</div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">
                    You {allocation.human} units · {humanPoints} pts
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                    Agent {allocation.agent} units · {agentPoints} pts
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="whitespace-nowrap">
                  You: {allocation.human} units × {humanWeight} pts ={" "}
                  <span className="font-semibold text-sky-700">{humanPoints} pts</span>
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="whitespace-nowrap">
                  Agent: {allocation.agent} units × {agentWeight} pts ={" "}
                  <span className="font-semibold text-amber-700">{agentPoints} pts</span>
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={disabled || allocation.human <= 0}
                  aria-label={`Decrease ${issue.label}`}
                  onClick={() => updateIssue(issue, allocation.human - 1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Slider
                  value={[allocation.human]}
                  min={0}
                  max={issue.total}
                  step={1}
                  disabled={disabled}
                  onValueChange={(value) => updateIssue(issue, value[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={disabled || allocation.human >= issue.total}
                  aria-label={`Increase ${issue.label}`}
                  onClick={() => updateIssue(issue, allocation.human + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

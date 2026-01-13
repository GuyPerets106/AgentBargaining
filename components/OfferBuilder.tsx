"use client"

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import type { Issue, OfferAllocation } from "@/lib/types";
import { clamp } from "@/lib/utils";

export default function OfferBuilder({
  issues,
  draft,
  onChange,
  disabled,
}: {
  issues: Issue[];
  draft: OfferAllocation;
  onChange: (allocation: OfferAllocation) => void;
  disabled?: boolean;
}) {
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
        {issues.map((issue) => {
          const allocation = draft[issue.key] ?? { human: 0, agent: issue.total };
          return (
            <div key={issue.key} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">{issue.label}</div>
                  <div className="text-xs text-muted-foreground">Total units: {issue.total}</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Human {allocation.human}</span>
                  <span>/</span>
                  <span>Agent {allocation.agent}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
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

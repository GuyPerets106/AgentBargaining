"use client"

import { UserRound, Wand2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Issue, Offer } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function OfferCard({
  offer,
  issues,
  className,
}: {
  offer: Offer;
  issues: Issue[];
  className?: string;
}) {
  const isHuman = offer.by === "human";
  const Icon = isHuman ? UserRound : Wand2;

  return (
    <Card className={cn("border-border/70", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", isHuman ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent")}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-base">{isHuman ? "Your Offer" : "Agent Offer"}</CardTitle>
            <div className="text-xs text-muted-foreground">Turn {offer.turn}</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(offer.created_at).toLocaleTimeString()}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {issues.map((issue) => {
          const allocation = offer.allocation[issue.key];
          if (!allocation) return null;
          return (
            <div key={issue.key} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="font-medium text-foreground">{issue.label}</span>
              <span className="text-muted-foreground">
                Human {allocation.human} / Agent {allocation.agent}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

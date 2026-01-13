"use client"

import { Shield, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ConditionId } from "@/lib/types";

export default function ConditionBadge({ condition }: { condition: ConditionId }) {
  const isPersona = condition === "persona";
  return (
    <Badge variant={isPersona ? "secondary" : "outline"} className="gap-2">
      {isPersona ? <Sparkles className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
      {isPersona ? "Persona" : "Neutral"}
    </Badge>
  );
}

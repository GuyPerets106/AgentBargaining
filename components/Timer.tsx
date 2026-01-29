"use client";

import { useEffect, useRef, useState } from "react";
import { Timer as TimerIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDuration } from "@/lib/utils";

export default function Timer({
  endsAt,
  onExpire,
}: {
  endsAt?: string;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.parse(endsAt) - Date.now()) / 1000));
      setRemaining(diff);
      if (diff === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt, onExpire]);

  const isLastMinute = remaining > 0 && remaining <= 60;

  return (
    <Card
      className={cn(
        "border-2 shadow-lg transition-colors",
        isLastMinute ? "border-red-500/80 bg-white" : "glass-panel border-primary/30"
      )}
    >
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle
          className={cn(
            "text-sm font-semibold uppercase tracking-wide",
            isLastMinute ? "text-slate-700" : "text-muted-foreground"
          )}
        >
          Time Remaining
        </CardTitle>
        <TimerIcon className={cn("h-4 w-4", isLastMinute ? "text-slate-600" : "text-muted-foreground")} />
      </CardHeader>
      <CardContent className="flex items-baseline justify-between">
        <div className={cn("text-4xl font-semibold", isLastMinute ? "alarm-text" : "text-foreground")}>
          {formatDuration(remaining)}
        </div>
        <div className={cn("text-xs", isLastMinute ? "text-slate-500" : "text-muted-foreground")}>
          mm:ss
        </div>
      </CardContent>
    </Card>
  );
}

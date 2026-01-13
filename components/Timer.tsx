"use client";

import { useEffect, useRef, useState } from "react";
import { Timer as TimerIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";

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

  return (
    <Card className="glass-panel">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Time Remaining
        </CardTitle>
        <TimerIcon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex items-baseline justify-between">
        <div className="text-3xl font-semibold text-foreground">{formatDuration(remaining)}</div>
        <div className="text-xs text-muted-foreground">mm:ss</div>
      </CardContent>
    </Card>
  );
}

import { useEffect } from "react";

import { useSessionStore } from "@/store/useSessionStore";
import { nowIso } from "@/lib/utils";

export function usePageView(path: string) {
  const addEvent = useSessionStore((state) => state.addEvent);

  useEffect(() => {
    const startedAt = nowIso();
    const startedMs = Date.now();
    addEvent?.("page_view", { path, action: "enter", started_at: startedAt });

    return () => {
      const durationMs = Date.now() - startedMs;
      addEvent?.("page_view", {
        path,
        action: "exit",
        started_at: startedAt,
        duration_ms: durationMs,
      });
    };
  }, [addEvent, path]);
}

"use client";

import { useMemo, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const roleStyles: Record<ChatMessage["role"], string> = {
  human: "bg-primary/10 text-primary",
  agent: "bg-accent/10 text-accent",
  system: "bg-muted text-muted-foreground",
};

export default function ChatPanel({
  messages,
  onSend,
  disabled,
  isAwaiting,
}: {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  disabled?: boolean;
  isAwaiting?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const lastSystem = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "system") {
        return messages[i];
      }
    }
    return null;
  }, [messages]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  };

  return (
    <Card className="glass-panel h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base">Chat</CardTitle>
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-white/60 p-3">
          {lastSystem ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-white/80 px-3 py-2 text-xs text-muted-foreground">
              {lastSystem.content}
            </div>
          ) : null}
          {messages
            .filter((msg) => msg.role !== "system")
            .map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-1 rounded-xl px-3 py-2 text-sm",
                  roleStyles[message.role]
                )}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{message.role === "human" ? "You" : "Agent"}</span>
                  <span>{new Date(message.t).toLocaleTimeString()}</span>
                </div>
                <div className="whitespace-pre-wrap text-foreground">{message.content}</div>
              </div>
            ))}
          {messages.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Say hello or include extra context with your offer.
            </div>
          ) : null}
          {isAwaiting ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Agent is responding...
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <Textarea
            value={draft}
            disabled={disabled}
            placeholder="Type a short message…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleSend}
            disabled={disabled || draft.trim().length === 0}
          >
            <Send className="h-4 w-4" />
            Send Message
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

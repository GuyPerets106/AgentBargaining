"use client"

import Link from "next/link";
import { Handshake } from "lucide-react";

import { cn } from "@/lib/utils";

export default function LayoutShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-[92%] items-center justify-between px-6 py-4 sm:w-[90%] lg:w-[80%]">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Handshake className="h-5 w-5" />
            </span>
            Negotiation Lab
          </Link>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Classroom Study Mode
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-[92%] px-6 py-10 sm:w-[90%] lg:w-[80%]", className)}>
        {children}
      </main>
    </div>
  );
}

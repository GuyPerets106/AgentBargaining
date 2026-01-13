"use client"

import { cn } from "@/lib/utils";

export default function NegotiationLayout({
  left,
  center,
  right,
  bottom,
  className,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-6", className)}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr_1fr]">
        <div className="flex flex-col gap-4">{left}</div>
        <div className="flex flex-col gap-4">{center}</div>
        <div className="flex flex-col gap-4">{right}</div>
      </div>
      {bottom ? <div className="pt-2">{bottom}</div> : null}
    </section>
  );
}

"use client"

import { cn } from "@/lib/utils";

export default function NegotiationLayout({
  left,
  center,
  right,
  bottom,
  className,
}: {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
}) {
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);
  const columns =
    hasLeft && hasRight
      ? "lg:grid-cols-[1fr_1.4fr_1fr]"
      : hasLeft || hasRight
      ? "lg:grid-cols-[1.2fr_1.4fr]"
      : "lg:grid-cols-1";

  return (
    <section className={cn("grid gap-6", className)}>
      <div className={cn("grid gap-6", columns)}>
        {hasLeft ? <div className="flex flex-col gap-4">{left}</div> : null}
        <div className="flex flex-col gap-4">{center}</div>
        {hasRight ? <div className="flex flex-col gap-4">{right}</div> : null}
      </div>
      {bottom ? <div className="pt-2">{bottom}</div> : null}
    </section>
  );
}

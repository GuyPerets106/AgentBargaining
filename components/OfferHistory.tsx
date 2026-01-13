"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import OfferCard from "@/components/OfferCard";
import type { Issue, Offer } from "@/lib/types";

export default function OfferHistory({ offers, issues }: { offers: Offer[]; issues: Issue[] }) {
  return (
    <Card className="glass-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Offer History</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        {offers.length === 0 ? (
          <div className="text-sm text-muted-foreground">No offers yet. Start by proposing one.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard key={`${offer.by}-${offer.turn}`} offer={offer} issues={issues} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

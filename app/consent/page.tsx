"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

const consentSchema = z.object({
  consent: z
    .boolean()
    .refine((value) => value, { message: "Please check this box before proceeding." }),
});

type ConsentValues = z.infer<typeof consentSchema>;

export default function ConsentPage() {
  usePageView("/consent");
  const router = useRouter();
  const { session, addEvent } = useSessionStore();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConsentValues>({
    resolver: zodResolver(consentSchema),
    defaultValues: {
      consent: false,
    },
  });

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const onSubmit = () => {
    addEvent("consent", { accepted: true });
    router.push("/instructions");
  };

  return (
    <LayoutShell className="max-w-3xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Consent</CardTitle>
          <CardDescription>
            This study collects negotiation behavior data. Participation is voluntary, and you may
            stop at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
            <p>
              You will negotiate with an AI agent. All offers and messages are logged anonymously.
              No personally identifying information is collected.
            </p>
            <p>Estimated time: 6-8 minutes.</p>
          </div>
          <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
            <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-4 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" {...register("consent")} />
              <span>
                I have read the information above and consent to participate in this experiment.
              </span>
            </label>
            {errors.consent ? (
              <div className="text-sm text-destructive">{errors.consent.message}</div>
            ) : null}

            <Button type="submit" size="lg" className="w-full">
              Continue to Instructions
            </Button>
          </form>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

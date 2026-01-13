"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import LayoutShell from "@/components/LayoutShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

const consentSchema = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: "Consent is required." }) }),
  age_range: z.string().optional(),
  gender: z.string().optional(),
  notes: z.string().optional(),
});

type ConsentValues = z.infer<typeof consentSchema>;

export default function ConsentPage() {
  usePageView("/consent");
  const router = useRouter();
  const { session, updateParticipant, addEvent } = useSessionStore();

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

  const onSubmit = (values: ConsentValues) => {
    updateParticipant({
      age_range: values.age_range,
      gender: values.gender,
      notes: values.notes,
    });
    addEvent("consent", { accepted: true, demographics: values });
    router.push("/instructions");
  };

  return (
    <LayoutShell className="max-w-3xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Consent & Demographics</CardTitle>
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
              <div className="text-xs text-destructive">{errors.consent.message}</div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Age range (optional)</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm"
                  {...register("age_range")}
                >
                  <option value="">Select</option>
                  <option value="18-24">18-24</option>
                  <option value="25-34">25-34</option>
                  <option value="35-44">35-44</option>
                  <option value="45-54">45-54</option>
                  <option value="55+">55+</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Gender (optional)</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm"
                  {...register("gender")}
                >
                  <option value="">Select</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="nonbinary">Non-binary</option>
                  <option value="self_describe">Self-describe</option>
                  <option value="prefer_not">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Notes (optional, e.g., class section)
              </label>
              <Textarea placeholder="Optional notes" {...register("notes")} />
            </div>

            <Button type="submit" size="lg" className="w-full">
              Continue to Instructions
            </Button>
          </form>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

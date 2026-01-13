"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import LayoutShell from "@/components/LayoutShell";
import SurveyForm, { type SurveyValues } from "@/components/SurveyForm";
import { useToast } from "@/components/ui/use-toast";
import { nowIso } from "@/lib/utils";
import { usePageView } from "@/hooks/usePageView";
import { useSessionStore } from "@/store/useSessionStore";

export default function SurveyPage() {
  usePageView("/survey");
  const router = useRouter();
  const { toast } = useToast();
  const { session, attachSurvey, setSubmission, addEvent } = useSessionStore();

  useEffect(() => {
    if (!session) {
      router.replace("/");
    }
  }, [router, session]);

  const handleSubmit = async (values: SurveyValues) => {
    if (!session) return;
    const surveyPayload = {
      t: nowIso(),
      fairness: values.fairness,
      trust: values.trust,
      cooperativeness: values.cooperativeness,
      human_likeness: values.human_likeness,
      satisfaction: values.satisfaction,
      negotiate_again: values.negotiate_again,
      comment: values.comment?.trim() || undefined,
    };
    attachSurvey(surveyPayload);

    const submissionPayload = {
      ...session,
      survey: surveyPayload,
    };

    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionPayload),
      });
      if (!response.ok) {
        throw new Error(`Submit failed: ${response.status}`);
      }
      const data = (await response.json()) as { ok: boolean; stored_as?: string };
      setSubmission({ ok: true, stored_as: data.stored_as });
      toast({
        title: "Session saved",
        description: "Your responses have been recorded.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addEvent("error", { source: "submit", message });
      setSubmission({
        ok: false,
        error: message,
      });
      toast({
        title: "Submission failed",
        description: "You can download logs on the next screen.",
        variant: "destructive",
      });
    } finally {
      router.push("/done");
    }
  };

  if (!session) return null;

  return (
    <LayoutShell className="max-w-4xl">
      <SurveyForm onSubmit={handleSubmit} />
    </LayoutShell>
  );
}

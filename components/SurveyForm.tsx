"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const surveySchema = z.object({
  fairness: z.number().min(1).max(5),
  trust: z.number().min(1).max(5),
  cooperativeness: z.number().min(1).max(5),
  human_likeness: z.number().min(1).max(5),
  satisfaction: z.number().min(1).max(5),
  negotiate_again: z.number().min(1).max(5),
  comment: z.string().optional(),
});

export type SurveyValues = z.infer<typeof surveySchema>;

const likertItems: Array<{ key: keyof SurveyValues; label: string }> = [
  { key: "fairness", label: "The agent was fair" },
  { key: "trust", label: "I trusted the agent" },
  { key: "cooperativeness", label: "The agent was cooperative" },
  { key: "human_likeness", label: "The agent felt human-like" },
  { key: "satisfaction", label: "I am satisfied with the outcome" },
  { key: "negotiate_again", label: "I would negotiate with this agent again" },
];

export default function SurveyForm({ onSubmit }: { onSubmit: (values: SurveyValues) => Promise<void> | void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    handleSubmit,
    register,
    watch,
    control,
    formState: { errors },
  } = useForm<SurveyValues>({
    resolver: zodResolver(surveySchema),
  });

  const onFormSubmit = async (values: SurveyValues) => {
    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if all required fields are filled
  const watchedValues = watch();
  const allFieldsFilled = likertItems.every(
    (item) => watchedValues[item.key] !== undefined && watchedValues[item.key] !== null
  );

  return (
    <Card className="glass-panel">
      <CardHeader>
        <CardTitle className="text-lg">Post-Game Survey</CardTitle>
        <CardDescription>
          Please rate each statement from 1 (strongly disagree) to 5 (strongly agree).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
          {/* Scale legend */}
          <div className="flex items-center justify-between border-b pb-2 text-xs text-muted-foreground">
            <span>1 = Strongly Disagree</span>
            <span>3 = Neutral</span>
            <span>5 = Strongly Agree</span>
          </div>

          {likertItems.map((item) => (
            <Controller
              key={item.key}
              name={item.key}
              control={control}
              render={({ field }) => {
                const currentValue = field.value;
                return (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-foreground">{item.label}</legend>
                    <div className="grid grid-cols-5 gap-2">
                      {Array.from({ length: 5 }, (_, idx) => idx + 1).map((value) => {
                        const isSelected = currentValue === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => field.onChange(value)}
                            className={cn(
                              "flex items-center justify-center rounded-lg border-2 px-2 py-3 text-sm font-semibold transition-all",
                              isSelected
                                ? "border-primary bg-primary/15 text-primary shadow-sm ring-2 ring-primary/30"
                                : "border-input bg-background/70 text-muted-foreground hover:bg-muted/70 hover:border-muted-foreground/50"
                            )}
                            aria-pressed={isSelected}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                    {errors[item.key] ? (
                      <div className="text-xs font-medium text-destructive">
                        ⚠️ Please select a response.
                      </div>
                    ) : null}
                  </fieldset>
                );
              }}
            />
          ))}

          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Additional comments (optional)</div>
          <Textarea
            placeholder="Share anything about the experience."
            {...register("comment")}
            className="min-h-[100px]"
          />
          </div>

          {/* Progress indicator */}
          <div className="text-sm text-muted-foreground">
            {allFieldsFilled ? (
              <span className="text-green-600">✓ All questions answered - ready to submit</span>
            ) : (
              <span className="text-amber-600">
                {likertItems.filter((item) => watchedValues[item.key] !== undefined).length}/{likertItems.length} questions answered
              </span>
            )}
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Survey"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

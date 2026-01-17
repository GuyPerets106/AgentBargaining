"use client";

import { useCallback, useEffect, useState } from "react";

import LayoutShell from "@/components/LayoutShell";
import AnalyticsCharts from "@/components/admin/AnalyticsCharts";
import DataTable from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { usePageView } from "@/hooks/usePageView";
import { cn } from "@/lib/utils";

type AdminSession = {
  filename: string;
  stored_at: string;
  session_id: string;
  created_at: string;
  condition_id: string;
  participant_id: string;
  outcome_reason: string | null;
  turns: number;
  duration_seconds: number;
};

type SummaryMetrics = {
  sessions?: number;
  agreement_rate: number | null;
  avg_joint_utility: number | null;
  avg_efficiency: number | null;
  avg_fairness_index: number | null;
  avg_nash_product?: number | null;
  avg_nash_ratio: number | null;
  avg_nash_distance?: number | null;
  avg_pareto_distance?: number | null;
  pareto_efficiency_rate: number | null;
  avg_human_share?: number | null;
  avg_human_utility_ratio?: number | null;
  avg_agent_utility_ratio?: number | null;
  avg_ks_gap?: number | null;
  avg_acceptor_ratio?: number | null;
  avg_offer_nash_distance?: number | null;
  avg_offer_pareto_distance?: number | null;
  avg_duration?: number | null;
  avg_turns?: number | null;
  avg_response: number | null;
  avg_human_concession?: number | null;
  avg_agent_concession?: number | null;
  avg_burstiness?: number | null;
  avg_cri?: number | null;
};

type SummaryRow = SummaryMetrics & {
  condition_id: string;
};

type SummaryPersonaRow = SummaryMetrics & {
  persona_tag: string;
};

type SummaryOverallRow = SummaryMetrics & {
  label: string;
};

type PlotRow = {
  turn: number | string;
  neutral_human_concession: number | "";
  neutral_agent_concession: number | "";
  persona_human_concession: number | "";
  persona_agent_concession: number | "";
};

type LegendRow = {
  metric: string;
  definition: string;
  range: string;
  direction: string;
  notes: string;
};

type AnalyticsResponse = {
  ok: boolean;
  generated_at: string;
  file_count: number;
  summary: SummaryRow[];
  summary_personas: SummaryPersonaRow[];
  summary_overall: SummaryOverallRow[];
  sessions: Array<Record<string, unknown>>;
  offers: Array<Record<string, unknown>>;
  chats: Array<Record<string, unknown>>;
  survey: Array<Record<string, unknown>>;
  concessions: Array<Record<string, unknown>>;
  concession_curves: Array<Record<string, unknown>>;
  plots: PlotRow[];
  legend: LegendRow[];
};

export default function AdminPage() {
  usePageView("/admin");
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/sessions");
      if (!response.ok) {
        throw new Error(`Load failed: ${response.status}`);
      }
      const data = (await response.json()) as { ok: boolean; sessions: AdminSession[] };
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const response = await fetch("/api/admin/analytics", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Analytics failed: ${response.status}`);
      }
      const data = (await response.json()) as AnalyticsResponse;
      if (!data.ok) {
        throw new Error("Analytics response returned ok=false.");
      }
      setAnalytics(data);
    } catch (err) {
      setAnalyticsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadAnalytics();
  }, [loadAnalytics, loadSessions]);

  const handleDownload = async (filename: string) => {
    setDownloading(filename);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sessions/${encodeURIComponent(filename)}`);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <LayoutShell className="max-w-7xl">
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Admin: Analytics</CardTitle>
          <CardDescription>
            Summary metrics, plots, and full raw tables derived from{" "}
            <span className="font-mono">data/</span> sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {analyticsLoading
                ? "Recomputing analytics..."
                : analytics
                  ? `Last updated ${new Date(analytics.generated_at).toLocaleString()} (${analytics.file_count} files)`
                  : "No analytics data loaded yet."}
            </div>
            <Button
              variant="outline"
              onClick={() => void Promise.all([loadSessions(), loadAnalytics()])}
              disabled={loading || analyticsLoading}
            >
              Refresh Analytics
            </Button>
          </div>

          {analyticsError ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {analyticsError}
            </div>
          ) : null}

          <Separator />

          <div className="space-y-10">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-foreground">Legend</div>
                  <div className="text-sm text-muted-foreground">
                    Definitions and expected direction for each metric.
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLegendOpen((prev) => !prev)}
                  aria-expanded={legendOpen}
                >
                  {legendOpen ? "Hide legend" : "Show legend"}
                </Button>
              </div>
              {legendOpen ? (
                analytics?.legend?.length ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {analytics.legend.map((item) => {
                      const direction =
                        item.direction === "Higher is better"
                          ? "bg-emerald-100 text-emerald-700"
                          : item.direction === "Lower is better"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700";
                      return (
                        <div
                          key={item.metric}
                          className="rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-foreground">
                              {item.metric}
                            </div>
                            <Badge className={direction}>{item.direction}</Badge>
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">
                            {item.definition}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Range: {item.range}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{item.notes}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                    No legend data available.
                  </div>
                )
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                  Legend is collapsed. Click “Show legend” to view definitions.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-foreground">Plots</div>
              <div className="text-sm text-muted-foreground">
                Visual comparisons across conditions and concession dynamics.
              </div>
            </div>
              <AnalyticsCharts
                summary={analytics?.summary ?? []}
                summaryPersonas={analytics?.summary_personas ?? []}
                summaryOverall={analytics?.summary_overall ?? []}
                plots={analytics?.plots ?? []}
              />
            </div>

            <DataTable
              title="Summary Metrics"
              description="Aggregate outcomes by condition."
              rows={analytics?.summary ?? []}
              maxHeight="320px"
              dense
            />

            <DataTable
              title="Summary Metrics (Personas)"
              description="Aggregate outcomes by persona tag."
              rows={analytics?.summary_personas ?? []}
              maxHeight="320px"
              dense
            />

            <DataTable
              title="Summary Metrics (Overall)"
              description="Aggregate outcomes across all sessions."
              rows={analytics?.summary_overall ?? []}
              maxHeight="220px"
              dense
            />

            <DataTable
              title="Sessions"
              description="Per-session outcomes and utilities."
              rows={analytics?.sessions ?? []}
              maxHeight="420px"
            />

            <DataTable
              title="Offers"
              description="All offers with allocations and utilities."
              rows={analytics?.offers ?? []}
              maxHeight="420px"
              dense
            />

            <DataTable
              title="Chat Messages"
              description="All chat messages and content length."
              rows={analytics?.chats ?? []}
              maxHeight="420px"
            />

            <DataTable
              title="Survey Responses"
              description="Post-game survey answers."
              rows={analytics?.survey ?? []}
              maxHeight="320px"
              dense
            />

            <DataTable
              title="Concessions"
              description="Per-offer concessions and cumulative values."
              rows={analytics?.concessions ?? []}
              maxHeight="420px"
              dense
            />

            <DataTable
              title="Concession Curves"
              description="Average concession metrics per condition, role, and turn."
              rows={analytics?.concession_curves ?? []}
              maxHeight="320px"
              dense
            />
          </div>
        </CardContent>
      </Card>

      <div className="h-10" />

      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="text-2xl">Admin: Session Logs</CardTitle>
          <CardDescription>
            Sessions saved locally in <span className="font-mono">data/</span> are listed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {loading ? "Loading sessions..." : `${sessions.length} session(s) found.`}
            </div>
            <Button variant="outline" onClick={loadSessions} disabled={loading}>
              Refresh List
            </Button>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Separator />

          <div className="space-y-4">
            {sessions.length === 0 && !loading ? (
              <div className="text-sm text-muted-foreground">No sessions saved yet.</div>
            ) : null}
            {sessions.map((session) => (
              <div
                key={session.filename}
                className="grid gap-3 rounded-xl border border-border/60 bg-background/70 p-4 md:grid-cols-[1.2fr_1fr_0.7fr_0.6fr]"
              >
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Session</div>
                  <div className="font-mono text-xs text-foreground">{session.session_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Saved {new Date(session.stored_at).toLocaleString()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Participant</div>
                  <div className="text-sm font-semibold text-foreground">
                    {session.participant_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Condition: {session.condition_id}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase text-muted-foreground">Outcome</div>
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      session.outcome_reason === "agreement"
                        ? "text-emerald-600"
                        : "text-amber-600"
                    )}
                  >
                    {session.outcome_reason ?? "incomplete"}
                  </div>
                  <div className="text-xs text-muted-foreground">Turns: {session.turns}</div>
                </div>
                <div className="flex items-center justify-start md:justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => handleDownload(session.filename)}
                    disabled={downloading === session.filename}
                  >
                    {downloading === session.filename ? "Downloading..." : "Download JSON"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </LayoutShell>
  );
}

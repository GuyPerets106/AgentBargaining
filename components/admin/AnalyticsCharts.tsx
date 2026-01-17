"use client";

import { useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

type MetricDefinition = {
  key: keyof SummaryMetrics;
  title: string;
  subtitle?: string;
  format: (value: number) => string;
  domain?: [number, number] | [number, "auto"] | ["auto", "auto"];
  tickFormatter?: (value: number) => string;
};

type MetricDatum = {
  label: string;
  value: number;
  raw: number | null;
  kind: "condition" | "persona" | "overall";
  groupKey: string;
  color: string;
};

const COLORS = {
  neutral: "#334155",
  persona: "#2563eb",
  neutralLight: "#94a3b8",
  personaLight: "#93c5fd",
  overall: "#64748b",
};

const PERSONA_PALETTE = [
  "#0ea5e9",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#f43f5e",
];

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const formatNumber = (value: number) => numberFormatter.format(value);
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const METRIC_SECTIONS: Array<{ title: string; metrics: MetricDefinition[] }> = [
  {
    title: "Session Volume & Agreement",
    metrics: [
      { key: "sessions", title: "Sessions", format: formatNumber },
      {
        key: "agreement_rate",
        title: "Agreement Rate",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_duration",
        title: "Avg Duration (s)",
        format: (value) => `${formatNumber(value)} s`,
      },
      { key: "avg_turns", title: "Avg Turns", format: formatNumber },
      {
        key: "avg_response",
        title: "Avg Response (s)",
        format: (value) => `${formatNumber(value)} s`,
      },
    ],
  },
  {
    title: "Utility & Fairness",
    metrics: [
      { key: "avg_joint_utility", title: "Avg Joint Utility", format: formatNumber },
      {
        key: "avg_human_share",
        title: "Avg Human Share",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_human_utility_ratio",
        title: "Human Utility Ratio",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_agent_utility_ratio",
        title: "Agent Utility Ratio",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_ks_gap",
        title: "KS Gap",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_fairness_index",
        title: "Fairness Index",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_acceptor_ratio",
        title: "Acceptor Ratio",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
    ],
  },
  {
    title: "Efficiency & Optimality",
    metrics: [
      {
        key: "avg_efficiency",
        title: "Efficiency",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      { key: "avg_nash_product", title: "Nash Product", format: formatNumber },
      {
        key: "avg_nash_ratio",
        title: "Nash Ratio",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      { key: "avg_nash_distance", title: "Nash Distance", format: formatNumber },
      {
        key: "avg_pareto_distance",
        title: "Pareto Distance",
        format: formatNumber,
      },
      {
        key: "pareto_efficiency_rate",
        title: "Pareto Rate",
        format: formatPercent,
        domain: [0, 1],
        tickFormatter: formatPercent,
      },
      {
        key: "avg_offer_nash_distance",
        title: "Avg Offer Nash Distance",
        format: formatNumber,
      },
      {
        key: "avg_offer_pareto_distance",
        title: "Avg Offer Pareto Distance",
        format: formatNumber,
      },
    ],
  },
  {
    title: "Negotiation Dynamics",
    metrics: [
      {
        key: "avg_human_concession",
        title: "Human Concession",
        format: formatNumber,
      },
      {
        key: "avg_agent_concession",
        title: "Agent Concession",
        format: formatNumber,
      },
      {
        key: "avg_burstiness",
        title: "Burstiness",
        format: (value) => value.toFixed(3),
        domain: [-1, 1],
      },
      {
        key: "avg_cri",
        title: "CRI",
        format: (value) => value.toFixed(3),
        domain: [-1, 1],
      },
    ],
  },
];

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-background/80">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  );
}

function formatMetricValue(metric: MetricDefinition, raw: number | null | undefined) {
  if (raw === null || raw === undefined) return "n/a";
  return metric.format(raw);
}

export default function AnalyticsCharts({
  summary,
  summaryPersonas,
  summaryOverall,
  plots,
}: {
  summary: SummaryRow[];
  summaryPersonas: SummaryPersonaRow[];
  summaryOverall: SummaryOverallRow[];
  plots: PlotRow[];
}) {
  if (!summary.length && !summaryPersonas.length && !summaryOverall.length) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        No summary data yet.
      </div>
    );
  }

  const personaColorMap = new Map<string, string>();
  summaryPersonas.forEach((row, index) => {
    personaColorMap.set(row.persona_tag, PERSONA_PALETTE[index % PERSONA_PALETTE.length]);
  });

  const buildMetricData = (key: keyof SummaryMetrics): MetricDatum[] => {
    const data: MetricDatum[] = [];
    summary.forEach((row) => {
      const raw = row[key] ?? null;
      data.push({
        label: `Cond: ${row.condition_id}`,
        value: typeof raw === "number" ? raw : 0,
        raw,
        kind: "condition",
        groupKey: row.condition_id,
        color: row.condition_id === "neutral" ? COLORS.neutral : COLORS.persona,
      });
    });
    summaryPersonas.forEach((row) => {
      const raw = row[key] ?? null;
      const color = personaColorMap.get(row.persona_tag) ?? COLORS.personaLight;
      data.push({
        label: `Persona: ${row.persona_tag}`,
        value: typeof raw === "number" ? raw : 0,
        raw,
        kind: "persona",
        groupKey: row.persona_tag,
        color,
      });
    });
    summaryOverall.forEach((row) => {
      const raw = row[key] ?? null;
      data.push({
        label: "Overall",
        value: typeof raw === "number" ? raw : 0,
        raw,
        kind: "overall",
        groupKey: row.label,
        color: COLORS.overall,
      });
    });
    return data;
  };

  const concessionData = plots.map((row) => ({
    turn: typeof row.turn === "string" ? Number(row.turn) : row.turn,
    neutral_human: row.neutral_human_concession || 0,
    neutral_agent: row.neutral_agent_concession || 0,
    persona_human: row.persona_human_concession || 0,
    persona_agent: row.persona_agent_concession || 0,
  }));

  const [lineVisibility, setLineVisibility] = useState({
    neutral_human: true,
    neutral_agent: true,
    persona_human: true,
    persona_agent: true,
  });

  const lineOptions = [
    {
      key: "neutral_human",
      label: "Neutral Condition · Human",
      color: COLORS.neutral,
    },
    {
      key: "neutral_agent",
      label: "Neutral Condition · Agent",
      color: COLORS.neutralLight,
    },
    {
      key: "persona_human",
      label: "Persona Condition · Human",
      color: COLORS.persona,
    },
    {
      key: "persona_agent",
      label: "Persona Condition · Agent",
      color: COLORS.personaLight,
    },
  ];

  return (
    <div className="space-y-10">
      {METRIC_SECTIONS.map((section) => (
        <div key={section.title} className="space-y-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {section.title}
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {section.metrics.map((metric) => {
              const data = buildMetricData(metric.key);
              return (
                <ChartCard key={metric.key} title={metric.title} subtitle={metric.subtitle}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 36 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#475569", fontSize: 11 }}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis
                        tick={{ fill: "#475569", fontSize: 11 }}
                        domain={metric.domain ?? ["auto", "auto"]}
                        tickFormatter={metric.tickFormatter}
                      />
                      <Tooltip
                        formatter={(value, _name, item) =>
                          formatMetricValue(metric, item?.payload?.raw)
                        }
                        cursor={{ fill: "#e2e8f0" }}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {data.map((entry, index) => (
                          <Cell key={`${entry.groupKey}-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              );
            })}
          </div>
        </div>
      ))}

      <ChartCard
        title="Concession Curves by Turn"
        subtitle="Average concession per turn by role; condition refers to agent language."
      >
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {lineOptions.map((line) => {
              const active = lineVisibility[line.key as keyof typeof lineVisibility];
              return (
                <button
                  key={line.key}
                  type="button"
                  onClick={() =>
                    setLineVisibility((prev) => ({
                      ...prev,
                      [line.key]: !prev[line.key as keyof typeof prev],
                    }))
                  }
                  aria-pressed={active}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? "border-transparent bg-slate-900 text-slate-50"
                      : "border-border bg-background text-muted-foreground hover:border-slate-400"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  {line.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={concessionData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="turn" tick={{ fill: "#475569" }} />
                <YAxis tick={{ fill: "#475569" }} />
                <Tooltip />
                <Legend />
                {lineVisibility.neutral_human ? (
                  <Line
                    type="monotone"
                    dataKey="neutral_human"
                    name="Neutral Condition · Human"
                    stroke={COLORS.neutral}
                    strokeWidth={2}
                    dot={false}
                  />
                ) : null}
                {lineVisibility.neutral_agent ? (
                  <Line
                    type="monotone"
                    dataKey="neutral_agent"
                    name="Neutral Condition · Agent"
                    stroke={COLORS.neutralLight}
                    strokeWidth={2}
                    dot={false}
                  />
                ) : null}
                {lineVisibility.persona_human ? (
                  <Line
                    type="monotone"
                    dataKey="persona_human"
                    name="Persona Condition · Human"
                    stroke={COLORS.persona}
                    strokeWidth={2}
                    dot={false}
                  />
                ) : null}
                {lineVisibility.persona_agent ? (
                  <Line
                    type="monotone"
                    dataKey="persona_agent"
                    name="Persona Condition · Agent"
                    stroke={COLORS.personaLight}
                    strokeWidth={2}
                    dot={false}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SummaryRow = {
  condition_id: string;
  agreement_rate: number | null;
  avg_joint_utility: number | null;
  avg_efficiency: number | null;
  avg_fairness_index: number | null;
  avg_nash_ratio: number | null;
  pareto_efficiency_rate: number | null;
  avg_response: number | null;
};

type PlotRow = {
  turn: number | string;
  neutral_human_concession: number | "";
  neutral_agent_concession: number | "";
  persona_human_concession: number | "";
  persona_agent_concession: number | "";
};

const COLORS = {
  neutral: "#334155",
  persona: "#2563eb",
  neutralLight: "#94a3b8",
  personaLight: "#93c5fd",
};

const percentFormatter = (value: number) => `${Math.round(value * 100)}%`;

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
      <CardContent className="h-72">{children}</CardContent>
    </Card>
  );
}

export default function AnalyticsCharts({
  summary,
  plots,
}: {
  summary: SummaryRow[];
  plots: PlotRow[];
}) {
  if (!summary.length) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        No summary data yet.
      </div>
    );
  }

  const summaryData = summary.map((row) => ({
    condition: row.condition_id,
    agreement_rate: row.agreement_rate ?? 0,
    avg_efficiency: row.avg_efficiency ?? 0,
    avg_fairness_index: row.avg_fairness_index ?? 0,
    avg_joint_utility: row.avg_joint_utility ?? 0,
    avg_nash_ratio: row.avg_nash_ratio ?? 0,
    pareto_efficiency_rate: row.pareto_efficiency_rate ?? 0,
    avg_response: row.avg_response ?? 0,
  }));

  const concessionData = plots.map((row) => ({
    turn: typeof row.turn === "string" ? Number(row.turn) : row.turn,
    neutral_human: row.neutral_human_concession || 0,
    neutral_agent: row.neutral_agent_concession || 0,
    persona_human: row.persona_human_concession || 0,
    persona_agent: row.persona_agent_concession || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Agreement Rate" subtitle="Share of sessions that reached agreement">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summaryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="condition" tick={{ fill: "#475569" }} />
              <YAxis tick={{ fill: "#475569" }} domain={[0, 1]} tickFormatter={percentFormatter} />
              <Tooltip formatter={(value) => percentFormatter(Number(value))} />
              <Bar dataKey="agreement_rate" fill={COLORS.persona} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Efficiency vs Fairness"
          subtitle="Higher is better (0-1 scale)"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summaryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="condition" tick={{ fill: "#475569" }} />
              <YAxis tick={{ fill: "#475569" }} domain={[0, 1]} tickFormatter={percentFormatter} />
              <Tooltip formatter={(value) => percentFormatter(Number(value))} />
              <Legend />
              <Bar dataKey="avg_efficiency" name="Efficiency" fill={COLORS.persona} />
              <Bar dataKey="avg_fairness_index" name="Fairness" fill={COLORS.neutral} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Nash Ratio & Pareto Rate" subtitle="Higher indicates better outcomes">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summaryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="condition" tick={{ fill: "#475569" }} />
              <YAxis tick={{ fill: "#475569" }} domain={[0, 1]} tickFormatter={percentFormatter} />
              <Tooltip formatter={(value) => percentFormatter(Number(value))} />
              <Legend />
              <Bar dataKey="avg_nash_ratio" name="Nash Ratio" fill={COLORS.personaLight} />
              <Bar
                dataKey="pareto_efficiency_rate"
                name="Pareto Rate"
                fill={COLORS.neutralLight}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average Response Latency" subtitle="Seconds from human offer to agent">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summaryData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="condition" tick={{ fill: "#475569" }} />
              <YAxis tick={{ fill: "#475569" }} />
              <Tooltip formatter={(value) => `${Number(value).toFixed(2)} s`} />
              <Bar dataKey="avg_response" fill={COLORS.neutral} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Concession Curves by Turn"
        subtitle="Average concession (drop in own utility) per turn"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={concessionData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="turn" tick={{ fill: "#475569" }} />
            <YAxis tick={{ fill: "#475569" }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="neutral_human"
              name="Neutral Human"
              stroke={COLORS.neutral}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="neutral_agent"
              name="Neutral Agent"
              stroke={COLORS.neutralLight}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="persona_human"
              name="Persona Human"
              stroke={COLORS.persona}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="persona_agent"
              name="Persona Agent"
              stroke={COLORS.personaLight}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

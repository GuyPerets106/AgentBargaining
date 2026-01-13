export type ConditionId = "neutral" | "persona";

export type Issue = {
  key: string;
  label: string;
  total: number;
  icon?: string;
};

export type OfferAllocation = Record<
  string,
  {
    human: number;
    agent: number;
  }
>;

export type Offer = {
  turn: number;
  by: "human" | "agent";
  allocation: OfferAllocation;
  created_at: string;
};

export type ExperimentEventType =
  | "page_view"
  | "consent"
  | "instruction_ack"
  | "chat_send"
  | "chat_receive"
  | "offer_propose"
  | "offer_receive"
  | "offer_accept"
  | "offer_reject"
  | "timer_tick"
  | "error"
  | "end";

export type ExperimentEvent = {
  id: string;
  t: string;
  type: ExperimentEventType;
  payload: Record<string, unknown>;
};

export type SurveyResponse = {
  t: string;
  fairness: number;
  trust: number;
  cooperativeness: number;
  human_likeness: number;
  satisfaction: number;
  negotiate_again: number;
  comment?: string;
};

export type ExperimentSession = {
  session_id: string;
  created_at: string;
  participant: {
    participant_id: string;
    age_range?: string;
    gender?: string;
    notes?: string;
  };
  config: {
    domain_id: string;
    issues: Issue[];
    deadline_seconds: number;
    max_turns: number;
  };
  condition: {
    id: ConditionId;
    persona_tag?: string;
  };
  events: ExperimentEvent[];
  outcome: {
    ended_at?: string;
    reason?: "agreement" | "timeout" | "turn_limit" | "abort";
    agreed_offer?: Offer;
    utilities?: {
      human: number;
      agent: number;
      joint: number;
    };
    turns: number;
    duration_seconds: number;
  };
  survey?: SurveyResponse;
};

export type ChatMessage = {
  id: string;
  role: "human" | "agent" | "system";
  content: string;
  t: string;
};

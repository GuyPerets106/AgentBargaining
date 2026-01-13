import { v4 as uuidv4 } from "uuid";

import { DEFAULT_DOMAIN } from "@/lib/config";
import type { ConditionId, ExperimentEvent, ExperimentEventType, ExperimentSession } from "@/lib/types";
import { nowIso, shortId } from "@/lib/utils";

export function createSession(conditionId: ConditionId, personaTag?: string): ExperimentSession {
  return {
    session_id: uuidv4(),
    created_at: nowIso(),
    participant: {
      participant_id: shortId(),
    },
    config: {
      domain_id: DEFAULT_DOMAIN.domain_id,
      issues: DEFAULT_DOMAIN.issues,
      deadline_seconds: DEFAULT_DOMAIN.deadline_seconds,
      max_turns: DEFAULT_DOMAIN.max_turns,
    },
    condition: {
      id: conditionId,
      persona_tag: personaTag,
    },
    events: [],
    outcome: {
      turns: 0,
      duration_seconds: 0,
    },
  };
}

export function createEvent(
  type: ExperimentEventType,
  payload: Record<string, unknown>
): ExperimentEvent {
  return {
    id: uuidv4(),
    t: nowIso(),
    type,
    payload,
  };
}

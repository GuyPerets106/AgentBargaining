import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";

import { createEvent, createSession } from "@/lib/logger";
import type {
  ChatMessage,
  ConditionId,
  ExperimentEventType,
  ExperimentSession,
  Offer,
  OfferAllocation,
  SurveyResponse,
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

export type SubmissionState = {
  ok: boolean;
  stored_as?: string;
  error?: string;
};

type SessionStore = {
  session: ExperimentSession | null;
  offers: Offer[];
  chat: ChatMessage[];
  draftOffer: OfferAllocation | null;
  isAwaitingAgent: boolean;
  negotiationStartedAt?: string;
  deadlineEndsAt?: string;
  submission?: SubmissionState;
  initSession: (conditionId: ConditionId, personaTag?: string) => void;
  setCondition: (conditionId: ConditionId, personaTag?: string) => void;
  updateParticipant: (updates: ExperimentSession["participant"]) => void;
  addEvent: (type: ExperimentEventType, payload: Record<string, unknown>) => void;
  setCurrentOfferDraft: (allocation: OfferAllocation) => void;
  pushOffer: (offer: Offer) => void;
  pushChat: (message: Omit<ChatMessage, "id" | "t"> & { t?: string }) => void;
  setAwaitingAgent: (value: boolean) => void;
  startNegotiation: () => void;
  endSession: (params: {
    reason: "agreement" | "timeout" | "turn_limit" | "abort";
    agreedOffer?: Offer;
    utilities?: { human: number; agent: number; joint: number };
  }) => void;
  attachSurvey: (survey: SurveyResponse) => void;
  setSubmission: (submission: SubmissionState) => void;
  resetSession: () => void;
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      session: null,
      offers: [],
      chat: [],
      draftOffer: null,
      isAwaitingAgent: false,
      negotiationStartedAt: undefined,
      deadlineEndsAt: undefined,
      submission: undefined,
      initSession: (conditionId, personaTag) =>
        set(() => ({
          session: createSession(conditionId, personaTag),
          offers: [],
          chat: [],
          draftOffer: null,
          isAwaitingAgent: false,
          negotiationStartedAt: undefined,
          deadlineEndsAt: undefined,
          submission: undefined,
        })),
      setCondition: (conditionId, personaTag) =>
        set((state) => {
          if (!state.session) return {};
          return {
            session: {
              ...state.session,
              condition: { id: conditionId, persona_tag: personaTag },
            },
          };
        }),
      updateParticipant: (updates) =>
        set((state) => {
          if (!state.session) return {};
          return {
            session: {
              ...state.session,
              participant: {
                ...state.session.participant,
                ...updates,
              },
            },
          };
        }),
      addEvent: (type, payload) =>
        set((state) => {
          if (!state.session) return {};
          const event = createEvent(type, payload);
          return {
            session: {
              ...state.session,
              events: [...state.session.events, event],
            },
          };
        }),
      setCurrentOfferDraft: (allocation) => set(() => ({ draftOffer: allocation })),
      pushOffer: (offer) =>
        set((state) => {
          if (!state.session) return { offers: [...state.offers, offer] };
          const turns = state.offers.length + 1;
          return {
            offers: [...state.offers, offer],
            session: {
              ...state.session,
              outcome: {
                ...state.session.outcome,
                turns,
              },
            },
          };
        }),
      pushChat: (message) =>
        set((state) => {
          const chatMessage: ChatMessage = {
            id: uuidv4(),
            t: message.t ?? nowIso(),
            role: message.role,
            content: message.content,
          };
          return { chat: [...state.chat, chatMessage] };
        }),
      setAwaitingAgent: (value) => set(() => ({ isAwaitingAgent: value })),
      startNegotiation: () =>
        set((state) => {
          if (!state.session) return {};
          if (state.negotiationStartedAt) return {};
          const startedAt = nowIso();
          const deadlineEndsAt = new Date(
            Date.now() + state.session.config.deadline_seconds * 1000
          ).toISOString();
          return {
            negotiationStartedAt: startedAt,
            deadlineEndsAt,
          };
        }),
      endSession: ({ reason, agreedOffer, utilities }) =>
        set((state) => {
          if (!state.session) return {};
          const endedAt = nowIso();
          const start = state.negotiationStartedAt ?? state.session.created_at;
          const durationSeconds = Math.max(
            0,
            Math.round((Date.parse(endedAt) - Date.parse(start)) / 1000)
          );
          return {
            session: {
              ...state.session,
              outcome: {
                ...state.session.outcome,
                ended_at: endedAt,
                reason,
                agreed_offer: agreedOffer,
                utilities,
                turns: state.offers.length,
                duration_seconds: durationSeconds,
              },
            },
          };
        }),
      attachSurvey: (survey) =>
        set((state) => {
          if (!state.session) return {};
          return {
            session: {
              ...state.session,
              survey,
            },
          };
        }),
      setSubmission: (submission) => set(() => ({ submission })),
      resetSession: () =>
        set(() => ({
          session: null,
          offers: [],
          chat: [],
          draftOffer: null,
          isAwaitingAgent: false,
          negotiationStartedAt: undefined,
          deadlineEndsAt: undefined,
          submission: undefined,
        })),
    }),
    {
      name: "negotiation-session",
      partialize: (state) => ({
        session: state.session,
        offers: state.offers,
        chat: state.chat,
        draftOffer: state.draftOffer,
        negotiationStartedAt: state.negotiationStartedAt,
        deadlineEndsAt: state.deadlineEndsAt,
        submission: state.submission,
      }),
    }
  )
);

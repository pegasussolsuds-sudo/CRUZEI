import { create } from 'zustand';
import type { Match, Message } from '@cruzei/shared-types';

interface ChatState {
  currentMatch: Match | null;
  messages: Record<string, Message[]>;
  setCurrentMatch: (m: Match | null) => void;
  appendMessage: (matchId: string, msg: Message) => void;
  getMessages: (matchId: string) => Message[];
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentMatch: null,
  messages: {},
  setCurrentMatch(m) {
    set({ currentMatch: m });
  },
  appendMessage(matchId, msg) {
    const existing = get().messages[matchId] ?? [];
    set({ messages: { ...get().messages, [matchId]: [...existing, msg] } });
  },
  getMessages(matchId) {
    return get().messages[matchId] ?? [];
  },
}));

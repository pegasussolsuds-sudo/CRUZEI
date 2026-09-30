import { create } from 'zustand';
import type { MatchCelebration } from '@cruzei/shared-types';
import { api } from '../services/api';
import type { MatchInfo } from '../components/MatchModal';

// Comemoração do match pra QUEM RECEBE (quem curtiu primeiro; quem completou já vê o modal pela resposta da curtida).
// Chega por três caminhos — socket 'match:new', push em primeiro plano (plano B com o socket caído) e os pendentes do
// servidor (GET /likes/matches/pending, ao conectar) — e aparece UMA vez: fila única com dedupe por pessoa + momento do
// match. Uma de cada vez, e nunca por cima do modal de match de quem curtiu (contador localOpen). Marcada como vista no
// servidor ao APARECER (se o app cair no meio, não repete). Quem mostra é o MatchCelebrationHost.

/** a comemoração na fila: o que o MatchModal precisa + o momento (parte da chave do dedupe) */
export interface ReceivedMatch extends MatchInfo {
  matchedAt: string;
}

interface MatchCelebrationState {
  queue: ReceivedMatch[];
  /** a que está na tela agora */
  current: ReceivedMatch | null;
  /** modais de match de quem curtiu abertos agora (mapa, curtidas, cartão): a fila espera */
  localOpen: number;
  /** nova comemoração (socket ou pendente); repetida é ignorada */
  enqueue: (c: MatchCelebration) => boolean;
  /** busca as pendentes no servidor (ao conectar, push em primeiro plano, toque no push) */
  syncPending: () => Promise<void>;
  /** push de match com o app aberto: se o socket não trouxe, busca */
  fromPush: (userId: string) => void;
  /** toque no push do match: essa pessoa primeiro. false = já comemorada (quem chama abre a conversa) */
  open: (userId: string) => Promise<boolean>;
  /** mostra a próxima, se der (o host chama quando a tela está livre) */
  pump: () => void;
  /** fechou a atual (a próxima espera o host chamar o pump de novo) */
  close: () => void;
  /** o modal de quem curtiu abriu: a fila espera até soltar (devolve o "soltar") */
  holdLocal: () => () => void;
  /** logout */
  reset: () => void;
}

/** pessoa + momento: o mesmo match que chega pelo socket e pelos pendentes vira um só; um match novo depois, não */
const keyOf = (c: { userId: string; matchedAt: string }) => `${c.userId}|${c.matchedAt}`;

// já enfileiradas ou mostradas nesta sessão (fora do estado: não re-renderiza ninguém)
const known = new Set<string>();
/** pessoas já comemoradas nesta sessão (o toque no push de algo já mostrado vai direto pra conversa) */
const shownPeople = new Set<string>();
let syncing: Promise<void> | null = null;

export function toReceivedMatch(c: MatchCelebration): ReceivedMatch | null {
  if (!c?.peer?.id || typeof c.peer.name !== 'string' || !c.matchedAt) return null;
  return {
    userId: c.peer.id,
    name: c.peer.name,
    photo: c.peer.mainPhotoUrl ?? null,
    avatar: c.peer.avatar ?? null,
    conversationId: c.conversationId ?? null,
    matchedAt: c.matchedAt,
  };
}

function markSeen(userId: string): void {
  api.post(`/likes/matches/${userId}/seen`).catch(() => undefined);
}

export const useMatchCelebrationStore = create<MatchCelebrationState>((set, get) => ({
  queue: [],
  current: null,
  localOpen: 0,

  enqueue: (c) => {
    const m = toReceivedMatch(c);
    if (!m) return false;
    const k = keyOf(m);
    if (known.has(k)) return false;
    known.add(k);
    set((s) => ({ queue: [...s.queue, m] }));
    return true;
  },

  syncPending: () => {
    if (!syncing) {
      syncing = api
        .get<MatchCelebration[]>('/likes/matches/pending')
        .then((res) => {
          // o servidor manda a mais nova primeiro; a fila mostra na ordem em que aconteceram
          const list = Array.isArray(res.data) ? [...res.data].reverse() : [];
          for (const c of list) get().enqueue(c);
        })
        .catch(() => undefined)
        .finally(() => {
          syncing = null;
        });
    }
    return syncing;
  },

  fromPush: (userId) => {
    if (shownPeople.has(userId)) return;
    const s = get();
    if (s.current?.userId === userId || s.queue.some((m) => m.userId === userId)) return;
    void s.syncPending();
  },

  open: async (userId) => {
    const on = () => {
      const s = get();
      return s.current?.userId === userId || s.queue.some((m) => m.userId === userId);
    };
    if (!on()) await get().syncPending();
    const s = get();
    if (s.current?.userId === userId) return true;
    const i = s.queue.findIndex((m) => m.userId === userId);
    if (i < 0) return false;
    // essa pessoa na frente da fila
    set({ queue: [s.queue[i], ...s.queue.filter((_, j) => j !== i)] });
    return true;
  },

  pump: () => {
    const s = get();
    if (s.current || s.localOpen > 0 || s.queue.length === 0) return;
    const [next, ...rest] = s.queue;
    shownPeople.add(next.userId);
    set({ current: next, queue: rest });
    markSeen(next.userId);
  },

  // a próxima sai pelo host (ele confere se a tela está livre: splash, termos, cadastro)
  close: () => set({ current: null }),

  holdLocal: () => {
    set((s) => ({ localOpen: s.localOpen + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ localOpen: Math.max(0, s.localOpen - 1) }));
    };
  },

  reset: () => {
    known.clear();
    shownPeople.clear();
    set({ queue: [], current: null, localOpen: 0 });
  },
}));

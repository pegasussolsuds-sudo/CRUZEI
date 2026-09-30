import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { TourStepId } from '../components/tour/steps';

// Tour do mapa. Aparece UMA vez por conta neste aparelho: armado no cadastro (o arme fica gravado, então o app fechado
// no meio do avatar/fotos não perde o tour) e mostrado no primeiro mapa pronto. Gravado como visto ao APARECER (se o
// app cair no meio, não repete — dá pra rever em Ajuda e segurança). Quem mostra é o MapTourHost, no mapa.

/** 'queued' = esperando a tela ficar livre (mapa pronto, posição resolvida, sem splash, termos, comemoração do match) */
export type TourPhase = 'idle' | 'queued' | 'showing';
/** 'auto' = pós-cadastro; 'replay' = "Ver o tour do mapa" na Ajuda */
export type TourSource = 'auto' | 'replay';

/** onde o tour guarda o estado por conta (SecureStore no app; memória nos testes) */
export interface TourStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const KEY_PREFIX = 'metch.mapTour.v1.';
const ARMED = 'armed';
const DONE = 'done';

export function tourStorageKey(userId: string): string {
  return KEY_PREFIX + userId;
}

let storage: TourStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
};

/** testes: troca o armazenamento */
export function setTourStorage(s: TourStorage): void {
  storage = s;
}

function persist(userId: string, value: string): void {
  storage.set(tourStorageKey(userId), value).catch(() => undefined);
}

interface TourState {
  /** conta carregada (null = deslogado) */
  userId: string | null;
  /** leitura do aparelho terminou pra essa conta */
  loaded: boolean;
  /** cadastro feito neste aparelho e o tour ainda não apareceu */
  armed: boolean;
  /** já apareceu (ou foi pulado) pra essa conta neste aparelho */
  seen: boolean;
  phase: TourPhase;
  source: TourSource | null;
  /** passos desta rodada (resolvidos na hora de começar) */
  steps: TourStepId[];
  index: number;
  /** quando começou (ms): duração pras métricas */
  startedAt: number;
  /** a splash do boot está na tela (o RootNavigator avisa; true até o 1º aviso): o tour espera */
  splashing: boolean;

  /** troca de conta (login/logout/cadastro): lê o que ficou gravado pra ela */
  setUser: (userId: string | null) => Promise<void>;
  /** cadastro concluído agora: arma o tour pra essa conta */
  arm: (userId: string) => Promise<void>;
  /** "Ver o tour do mapa" (Ajuda): entra na fila mesmo já visto */
  replay: () => void;
  /** a tela ficou livre: começa (false = não tinha nada na fila) */
  begin: (steps: TourStepId[], now?: number) => boolean;
  /** passos resolvidos de novo (a posição chegou depois): só vale ainda nas boas-vindas (false = não mudou) */
  refreshSteps: (steps: TourStepId[]) => boolean;
  /** próximo passo; no último, fecha ('done') */
  next: () => 'next' | 'done';
  back: () => void;
  /** pular ou terminar */
  close: () => void;
  setSplashing: (splashing: boolean) => void;
}

const CLEAR_RUN = { phase: 'idle' as TourPhase, source: null, steps: [] as TourStepId[], index: 0, startedAt: 0 };

// cada troca de conta invalida leituras antigas ainda voando
let userGen = 0;

export const useTourStore = create<TourState>((set, get) => {
  /** armado, lido e nunca visto → fila (auto) */
  function maybeQueueAuto(): void {
    const s = get();
    if (s.userId && s.loaded && s.armed && !s.seen && s.phase === 'idle') set({ phase: 'queued', source: 'auto' });
  }

  return {
    userId: null,
    loaded: false,
    armed: false,
    seen: false,
    ...CLEAR_RUN,
    // começa "com splash" até o RootNavigator dizer que saiu (ele sempre avisa ao montar)
    splashing: true,

    async setUser(userId) {
      if (userId === get().userId) return;
      userGen += 1;
      const gen = userGen;
      set({ userId, loaded: false, armed: false, seen: false, ...CLEAR_RUN });
      if (!userId) return;
      let stored: string | null = null;
      try {
        stored = await storage.get(tourStorageKey(userId));
      } catch {
        /* sem storage: sem tour automático (dá pra rever na Ajuda) */
      }
      if (gen !== userGen) return; // trocou de conta enquanto lia
      // o arme pode ter chegado durante a leitura (cadastro): não perde
      set((s) => ({ loaded: true, seen: stored === DONE, armed: stored !== DONE && (s.armed || stored === ARMED) }));
      maybeQueueAuto();
    },

    async arm(userId) {
      if (get().userId !== userId) await get().setUser(userId);
      if (get().userId !== userId || get().seen) return;
      persist(userId, ARMED);
      set({ armed: true });
      maybeQueueAuto();
    },

    replay() {
      const s = get();
      if (!s.userId || s.phase === 'showing') return;
      set({ phase: 'queued', source: 'replay' });
    },

    begin(steps, now = Date.now()) {
      const s = get();
      if (s.phase !== 'queued' || !s.userId) return false;
      if (steps.length === 0) {
        set(CLEAR_RUN);
        return false;
      }
      // visto ao aparecer (auto ou revisto): o automático não volta
      persist(s.userId, DONE);
      set({ phase: 'showing', steps, index: 0, startedAt: now, seen: true, armed: false });
      return true;
    },

    refreshSteps(steps) {
      const s = get();
      // depois das boas-vindas não mexe no que a pessoa já está vendo (nem na contagem "2 de 6")
      if (s.phase !== 'showing' || s.index !== 0 || steps.length === 0 || steps[0] !== s.steps[0]) return false;
      if (steps.length === s.steps.length && steps.every((id, i) => id === s.steps[i])) return false;
      set({ steps });
      return true;
    },

    next() {
      const s = get();
      if (s.phase !== 'showing') return 'done';
      if (s.index < s.steps.length - 1) {
        set({ index: s.index + 1 });
        return 'next';
      }
      set(CLEAR_RUN);
      return 'done';
    },

    back() {
      const s = get();
      if (s.phase === 'showing' && s.index > 0) set({ index: s.index - 1 });
    },

    close() {
      set(CLEAR_RUN);
    },

    setSplashing(splashing) {
      if (get().splashing !== splashing) set({ splashing });
    },
  };
});

/** o tour ocupa a tela ou está esperando a vez (o pedido do push espera ele acabar) */
export function isTourBusy(s: Pick<TourState, 'phase'>): boolean {
  return s.phase !== 'idle';
}

export interface TourGate {
  phase: TourPhase;
  splashing: boolean;
  /** mapa pronto, em foco e sem nada aberto por cima (busca, match) */
  screenReady: boolean;
  termsPending: boolean;
  /** avatar/fotos do pós-cadastro ainda na frente */
  onboarding: boolean;
  /** comemoração do match na tela ou na fila */
  celebrationBusy: boolean;
  /** localização resolvida (ou cansou de esperar) e sem o diálogo de permissão do sistema: ver tourLocationReady */
  locationReady: boolean;
}

/** pode começar agora? (nunca junto de splash, termos, cadastro, comemoração do match ou diálogo de permissão) */
export function canBeginTour(g: TourGate): boolean {
  return (
    g.phase === 'queued' && !g.splashing && g.screenReady && !g.termsPending && !g.onboarding && !g.celebrationBusy && g.locationReady
  );
}

/** teto de espera pela posição com a tela livre (GPS lento): depois disso começa sem "Esse é você" */
export const TOUR_LOCATION_WAIT_MS = 8_000;

export interface TourLocation {
  /** tenho posição, ou ela foi negada/indisponível (esperar não adianta) */
  settled: boolean;
  /** o diálogo de permissão do sistema pode estar na tela */
  asking: boolean;
  /** passou TOUR_LOCATION_WAIT_MS com a tela livre e sem posição */
  waitedOut: boolean;
}

/**
 * A localização deixa o tour começar? Nunca com o diálogo de permissão; senão, com a posição resolvida (os passos
 * "Esse é você"/"Gente e lugares por perto" dependem dela) ou depois do teto de espera.
 */
export function tourLocationReady(l: TourLocation): boolean {
  return !l.asking && (l.settled || l.waitedOut);
}

// ---- ligação com a sessão ----

interface AuthLike {
  user: { id: string } | null;
  onboardingStep: string | null;
}

interface AuthStoreLike {
  getState: () => AuthLike;
  subscribe: (listener: (s: AuthLike, prev: AuthLike) => void) => () => void;
}

let unbind: (() => void) | null = null;

/**
 * Segue a conta logada e arma o tour no cadastro (onboardingStep sai de null: o register() acabou de criar a conta).
 * Chamado uma vez no boot (MapTourHost); chamar de novo troca a ligação (Fast Refresh).
 */
export function bindTourToAuth(auth: AuthStoreLike): () => void {
  unbind?.();
  const sync = (s: AuthLike, prev: AuthLike | null) => {
    const id = s.user?.id ?? null;
    const tour = useTourStore.getState();
    if (id !== tour.userId) void tour.setUser(id);
    if (id && prev && s.onboardingStep && !prev.onboardingStep) void useTourStore.getState().arm(id);
  };
  sync(auth.getState(), null);
  const off = auth.subscribe((s, prev) => sync(s, prev));
  unbind = off;
  return () => {
    off();
    if (unbind === off) unbind = null;
  };
}

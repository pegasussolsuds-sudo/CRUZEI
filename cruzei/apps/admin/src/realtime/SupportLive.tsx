// Suporte ao vivo em qualquer tela do painel: mantém a fila em cache atualizada pelo socket, conta quem
// está esperando (topo e barra lateral), põe o número no título da aba e toca um som discreto. Botão de emergência
// ('support:urgent'): alarme, aviso vermelho e a lista de urgentes valendo (faixa vermelha na fila, 🆘 no título).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { SUPPORT_EVENTS, type SupportThreadDetail, type SupportThreadList, type SupportThreadSummary } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';
import {
  applyMessageToSummary,
  applyToLiveQueue,
  applyUrgent,
  EMPTY_LIVE_QUEUE,
  isUrgentOpen,
  mergeMessage,
  oldestUrgent,
  seedLiveQueue,
  SUPPORT_FILTERS,
  upsertThreadInPages,
  type LiveQueue,
} from '@/lib/support';
import { readPref, writePref } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { useSocketEvent } from './SocketProvider';
import { playAlarm, playChime, unlockAudioOnFirstGesture } from './chime';

interface SupportLiveValue {
  enabled: boolean;
  /** atendimentos abertos esperando a equipe (o número do servidor: o mesmo do Painel) */
  waiting: number;
  /** mensagens que chegaram com a aba escondida */
  unseen: number;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** a tela de suporte avisa qual conversa está aberta (não conta como não lida, não toca som) */
  setViewing: (threadId: string | null) => void;
  /** resposta de read/assign/status: aplica já, sem esperar o socket */
  applyThread: (thread: SupportThreadSummary) => void;
  /** atendimentos URGENTES não resolvidos (botão de emergência) */
  urgentCount: number;
  /** o urgente mais antigo (a faixa vermelha abre ele) */
  firstUrgent: SupportThreadSummary | null;
}

const SupportLiveContext = createContext<SupportLiveValue>({
  enabled: false,
  waiting: 0,
  unseen: 0,
  soundOn: true,
  setSoundOn: () => undefined,
  setViewing: () => undefined,
  applyThread: () => undefined,
  urgentCount: 0,
  firstUrgent: null,
});

export function SupportLiveProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const enabled = hasPermission(me, 'support');
  const meId = me?.id ?? null;
  const viewing = useRef<string | null>(null);
  const [live, setLive] = useState<LiveQueue>(EMPTY_LIVE_QUEUE);
  const [unseen, setUnseen] = useState(0);
  const [soundOn, setSoundOnState] = useState(() => readPref('sound', 'on') !== 'off');
  const [urgent, setUrgent] = useState<ReadonlyMap<string, SupportThreadSummary>>(() => new Map());
  const toast = useToast();

  // semente: os abertos agora + o TOTAL do servidor (a lista vem paginada; o número não); o socket mantém daí em
  // diante e o refetch periódico cobre queda do socket
  const seed = useQuery({
    queryKey: qk.supportLive,
    queryFn: () => adminApi.supportThreads({ status: 'open', limit: 100 }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (seed.data) setLive(seedLiveQueue(seed.data.items, seed.data.total));
  }, [seed.data]);

  // urgentes valendo (abertos ou pendentes): semente do servidor; o socket mantém daí em diante
  const urgentSeed = useQuery({
    queryKey: qk.supportUrgent,
    queryFn: () => adminApi.supportThreads({ urgent: true, limit: 50 }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (urgentSeed.data) setUrgent(new Map(urgentSeed.data.items.filter(isUrgentOpen).map((t) => [t.id, t])));
  }, [urgentSeed.data]);

  // saiu dos abertos alguém fora da lista carregada: o total do servidor confirma (uma busca por rajada)
  const recheckTimer = useRef<number | undefined>(undefined);
  const recheck = useCallback(() => {
    window.clearTimeout(recheckTimer.current);
    recheckTimer.current = window.setTimeout(() => void qc.invalidateQueries({ queryKey: qk.supportLive }), 1000);
  }, [qc]);
  useEffect(() => () => window.clearTimeout(recheckTimer.current), []);

  const applyThread = useCallback(
    (thread: SupportThreadSummary) => {
      setLive((q) => {
        const r = applyToLiveQueue(q, thread);
        if (r.recheck) recheck();
        return r.queue;
      });
      setUrgent((m) => (isUrgentOpen(thread) || m.has(thread.id) ? applyUrgent(m, thread) : m));
      for (const f of SUPPORT_FILTERS) {
        qc.setQueryData<InfiniteData<SupportThreadList, string | null>>(qk.supportThreads(f.key), (old) =>
          old ? { ...old, pages: upsertThreadInPages(old.pages, thread, f.key, meId) } : old,
        );
      }
      qc.setQueryData<SupportThreadDetail>(qk.supportThread(thread.id), (old) => (old ? { ...old, ...thread } : old));
    },
    [qc, meId, recheck],
  );

  useSocketEvent(SUPPORT_EVENTS.thread, ({ thread }) => {
    if (enabled) applyThread(thread);
  });

  // botão de emergência apertado agora: alarme (mesmo com o som de mensagens desligado) + aviso vermelho
  useSocketEvent(SUPPORT_EVENTS.urgent, ({ thread }) => {
    if (!enabled) return;
    applyThread(thread);
    playAlarm();
    toast.error(`🆘 Emergência: ${thread.user.name} apertou o botão de emergência. Atendimento no topo da fila.`);
    if (document.hidden) setUnseen((n) => n + 1);
  });

  useSocketEvent(SUPPORT_EVENTS.message, ({ threadId, message }) => {
    if (!enabled) return;
    const isViewing = viewing.current === threadId && !document.hidden;
    qc.setQueryData<SupportThreadDetail>(qk.supportThread(threadId), (old) =>
      old ? { ...applyMessageToSummary(old, message, isViewing), messages: mergeMessage(old.messages, message) } : old,
    );
    // resumo provisório até o 'support:thread' do servidor chegar
    setLive((q) => {
      const t = q.open.get(threadId);
      if (!t) return q;
      const open = new Map(q.open);
      open.set(threadId, applyMessageToSummary(t, message, isViewing));
      return { ...q, open };
    });
    if (message.author === 'user') {
      if (!live.open.has(threadId)) recheck();
      if (document.hidden) setUnseen((n) => n + 1);
      if (soundOn && !isViewing) playChime();
    }
  });

  // o alarme de emergência toca sempre: o áudio é liberado no 1º gesto mesmo com o som de mensagens desligado
  useEffect(() => (enabled ? unlockAudioOnFirstGesture() : undefined), [enabled]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setUnseen(0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const setSoundOn = useCallback((on: boolean) => {
    setSoundOnState(on);
    writePref('sound', on ? 'on' : 'off');
  }, []);

  const setViewing = useCallback((threadId: string | null) => {
    viewing.current = threadId;
  }, []);

  const waiting = live.total;
  const urgentCount = enabled ? urgent.size : 0;
  const firstUrgent = useMemo(() => (enabled ? oldestUrgent(urgent) : null), [enabled, urgent]);

  const value = useMemo<SupportLiveValue>(
    () => ({ enabled, waiting: enabled ? waiting : 0, unseen, soundOn, setSoundOn, setViewing, applyThread, urgentCount, firstUrgent }),
    [enabled, waiting, unseen, soundOn, setSoundOn, setViewing, applyThread, urgentCount, firstUrgent],
  );

  return <SupportLiveContext.Provider value={value}>{children}</SupportLiveContext.Provider>;
}

export function useSupportLive(): SupportLiveValue {
  return useContext(SupportLiveContext);
}

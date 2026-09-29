// Suporte ao vivo em qualquer tela do painel: mantém a fila em cache atualizada pelo socket, conta quem
// está esperando (topo e barra lateral), põe o número no título da aba e toca um som discreto.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { SUPPORT_EVENTS, type SupportThreadDetail, type SupportThreadList, type SupportThreadSummary } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';
import { applyMessageToSummary, countWaiting, mergeMessage, SUPPORT_FILTERS, upsertThreadInPages } from '@/lib/support';
import { readPref, writePref } from '@/lib/prefs';
import { useSocketEvent } from './SocketProvider';
import { playChime, unlockAudioOnFirstGesture } from './chime';

interface SupportLiveValue {
  enabled: boolean;
  /** atendimentos abertos esperando a equipe */
  waiting: number;
  /** mensagens que chegaram com a aba escondida */
  unseen: number;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** a tela de suporte avisa qual conversa está aberta (não conta como não lida, não toca som) */
  setViewing: (threadId: string | null) => void;
  /** resposta de read/assign/status: aplica já, sem esperar o socket */
  applyThread: (thread: SupportThreadSummary) => void;
}

const SupportLiveContext = createContext<SupportLiveValue>({
  enabled: false,
  waiting: 0,
  unseen: 0,
  soundOn: true,
  setSoundOn: () => undefined,
  setViewing: () => undefined,
  applyThread: () => undefined,
});

export function SupportLiveProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const enabled = hasPermission(me, 'support');
  const meId = me?.id ?? null;
  const viewing = useRef<string | null>(null);
  const [live, setLive] = useState<Map<string, SupportThreadSummary>>(() => new Map());
  const [unseen, setUnseen] = useState(0);
  const [soundOn, setSoundOnState] = useState(() => readPref('sound', 'on') !== 'off');

  // semente: os abertos agora; o socket mantém daí em diante (e o refetch periódico cobre queda do socket)
  const seed = useQuery({
    queryKey: qk.supportLive,
    queryFn: () => adminApi.supportThreads({ status: 'open' }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (seed.data) setLive(new Map(seed.data.items.map((t) => [t.id, t])));
  }, [seed.data]);

  const applyThread = useCallback(
    (thread: SupportThreadSummary) => {
      setLive((m) => {
        const next = new Map(m);
        if (thread.status === 'open') next.set(thread.id, thread);
        else next.delete(thread.id);
        return next;
      });
      for (const f of SUPPORT_FILTERS) {
        qc.setQueryData<InfiniteData<SupportThreadList, string | null>>(qk.supportThreads(f.key), (old) =>
          old ? { ...old, pages: upsertThreadInPages(old.pages, thread, f.key, meId) } : old,
        );
      }
      qc.setQueryData<SupportThreadDetail>(qk.supportThread(thread.id), (old) => (old ? { ...old, ...thread } : old));
    },
    [qc, meId],
  );

  useSocketEvent(SUPPORT_EVENTS.thread, ({ thread }) => {
    if (enabled) applyThread(thread);
  });

  useSocketEvent(SUPPORT_EVENTS.message, ({ threadId, message }) => {
    if (!enabled) return;
    const isViewing = viewing.current === threadId && !document.hidden;
    qc.setQueryData<SupportThreadDetail>(qk.supportThread(threadId), (old) =>
      old ? { ...applyMessageToSummary(old, message, isViewing), messages: mergeMessage(old.messages, message) } : old,
    );
    // resumo provisório até o 'support:thread' do servidor chegar
    setLive((m) => {
      const t = m.get(threadId);
      if (!t) return m;
      const next = new Map(m);
      next.set(threadId, applyMessageToSummary(t, message, isViewing));
      return next;
    });
    if (message.author === 'user') {
      if (!live.has(threadId)) void qc.invalidateQueries({ queryKey: qk.supportLive });
      if (document.hidden) setUnseen((n) => n + 1);
      if (soundOn && !isViewing) playChime();
    }
  });

  useEffect(() => (enabled && soundOn ? unlockAudioOnFirstGesture() : undefined), [enabled, soundOn]);

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

  const waiting = useMemo(() => countWaiting(live.values()), [live]);

  const value = useMemo<SupportLiveValue>(
    () => ({ enabled, waiting: enabled ? waiting : 0, unseen, soundOn, setSoundOn, setViewing, applyThread }),
    [enabled, waiting, unseen, soundOn, setSoundOn, setViewing, applyThread],
  );

  return <SupportLiveContext.Provider value={value}>{children}</SupportLiveContext.Provider>;
}

export function useSupportLive(): SupportLiveValue {
  return useContext(SupportLiveContext);
}

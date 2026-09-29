// Socket do painel (mesmo gateway do app). Só abre pra quem atende o suporte.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@cruzei/shared-types';
import { refreshAccessToken, SOCKET_ORIGIN } from '@/api/http';
import { session } from '@/api/session';
import { useAuth } from '@/auth/AuthProvider';
import { hasPermission } from '@/lib/permissions';

/** eventos do mesmo contrato do app (socket/events.types.ts); o painel só usa os de suporte */
export type AdminSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextValue {
  socket: AdminSocket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

const MAX_AUTH_RETRIES = 2;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const enabled = status === 'authenticated' && hasPermission(me, 'support');
  const [value, setValue] = useState<SocketContextValue>({ socket: null, connected: false });
  const retries = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    // auth como função: cada reconexão pega o token mais novo da memória
    const s: AdminSocket = io(SOCKET_ORIGIN, {
      transports: ['websocket'],
      auth: (cb) => cb({ token: session.getAccessToken() }),
    });
    setValue({ socket: s, connected: false });

    s.on('connect', () => {
      retries.current = 0;
      setValue({ socket: s, connected: true });
    });
    s.on('disconnect', () => setValue({ socket: s, connected: false }));
    s.on('connect_error', (err) => {
      setValue({ socket: s, connected: false });
      // recusa do middleware (token vencido) não reconecta sozinha: renova e tenta de novo, com teto
      if (err.message === 'unauthorized' && retries.current < MAX_AUTH_RETRIES) {
        retries.current += 1;
        void refreshAccessToken().then((ok) => {
          if (ok) s.connect();
        });
      }
    });

    // token renovado por um pedido HTTP: o socket conectado segue; se estiver caído, tenta já
    const offToken = session.onToken((token) => {
      if (token && !s.connected) s.connect();
    });

    return () => {
      offToken();
      s.removeAllListeners();
      s.disconnect();
      setValue({ socket: null, connected: false });
    };
  }, [enabled]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

/** visão "solta" do socket só pra registrar ouvinte genérico (o socket.io tipa on/off com sobrecarga por evento) */
interface LooseEmitter {
  on(event: string, listener: (payload: never) => void): unknown;
  off(event: string, listener: (payload: never) => void): unknown;
}

/** ouve um evento do servidor enquanto o componente estiver montado (handler sempre o mais novo) */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: (payload: Payload<E>) => void): void {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const emitter = socket as unknown as LooseEmitter;
    const listener = (payload: Payload<E>) => ref.current(payload);
    emitter.on(event, listener);
    return () => {
      emitter.off(event, listener);
    };
  }, [socket, event]);
}

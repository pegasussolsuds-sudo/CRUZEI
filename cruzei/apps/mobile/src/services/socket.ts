import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@cruzei/shared-types';
import { config } from '../config';
import { getToken, refreshAccessToken, reportAccountBlocked } from './api';

type CruzeiSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: CruzeiSocket | null = null;
let recovering = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastRecoverAt = 0;
const RECOVER_GAP_MS = 15_000;

function scheduleRecover(s: CruzeiSocket, delay: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (socket === s && !s.active) void recover(s);
  }, delay);
}

// Servidor recusou/derrubou o socket (token vencido): o socket.io-client NÃO reconecta sozinho nesse caso
// (`active === false`). Renova o token e reconecta na mão; o auth(cb) relê getToken() → token novo.
async function recover(s: CruzeiSocket) {
  if (recovering || socket !== s || s.connected) return;
  // se o servidor recusar de novo com token novo, não entra em loop de refresh+connect
  const wait = lastRecoverAt + RECOVER_GAP_MS - Date.now();
  if (wait > 0) return scheduleRecover(s, wait);
  lastRecoverAt = Date.now();
  recovering = true;
  try {
    const fresh = await refreshAccessToken();
    // null = refresh recusado: a sessão caiu, o interceptor HTTP derruba a UI na próxima requisição
    if (fresh && socket === s && !s.connected) s.connect();
  } catch {
    // rede/5xx: tenta de novo daqui a pouco
    scheduleRecover(s, RECOVER_GAP_MS);
  } finally {
    recovering = false;
  }
}

/** Volta pro app / quer garantir o realtime: reconecta se o socket morreu de vez. */
export function ensureSocketAlive(): void {
  if (socket && !socket.active) void recover(socket);
}

export async function connectSocket(): Promise<CruzeiSocket | null> {
  if (socket) return socket;
  const token = await getToken();
  if (!token) return null;

  socket = io(config.wsUrl, {
    transports: ['websocket'],
    // função → a cada reconexão pega o token mais novo (pós-refresh)
    auth: async (cb) => cb({ token: (await getToken()) ?? '' }),
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
  });

  socket.on('connect', () => {
    // eslint-disable-next-line no-console
    console.info('🟢 socket connected');
  });
  const s = socket;
  s.on('disconnect', (reason) => {
    // eslint-disable-next-line no-console
    console.info('🟡 socket disconnected:', reason);
    if (reason === 'io server disconnect') void recover(s);
  });
  s.on('connect_error', (err) => {
    // eslint-disable-next-line no-console
    console.info('🔴 socket error:', err.message);
    // conta suspensa/banida: o servidor manda o motivo em err.data — não tenta reconectar
    if (reportAccountBlocked((err as Error & { data?: unknown }).data)) {
      s.disconnect();
      return;
    }
    // recusa no middleware do servidor também desliga o loop de reconexão
    if (!s.active) void recover(s);
  });

  return socket;
}

export function getSocket(): CruzeiSocket | null {
  return socket;
}

/**
 * Intervalo do polling da lista de matches: com o socket conectado, match novo e mensagem chegam por evento
 * (App.tsx invalida a lista) e o polling é só rede de segurança — 2 min; sem socket, 30 s.
 * Com dezenas de milhares de pessoas no app, o polling de 30 s em TODAS as telas era a rota mais chamada do servidor.
 */
export function matchesPollMs(): number {
  return socket?.connected ? 120_000 : 30_000;
}

export function disconnectSocket(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

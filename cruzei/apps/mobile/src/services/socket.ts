import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@cruzei/shared-types';
import { config } from '../config';
import { getToken } from './api';

type CruzeiSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: CruzeiSocket | null = null;

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
  socket.on('disconnect', (reason) => {
    // eslint-disable-next-line no-console
    console.info('🟡 socket disconnected:', reason);
  });
  socket.on('connect_error', (err) => {
    // eslint-disable-next-line no-console
    console.info('🔴 socket error:', err.message);
  });

  return socket;
}

export function getSocket(): CruzeiSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

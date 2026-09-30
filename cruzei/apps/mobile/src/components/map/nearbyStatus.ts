// Estado da conexão da lista de pessoas por perto (GET /location/nearby). Falha sem lista nenhuma vira aviso de
// "sem conexão"; falha com a lista anterior em mãos vira um rótulo discreto com a idade dela. Nunca "0 pessoas" por
// causa de servidor fora nem dado velho com cara de atual.

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/**
 * por que a busca falhou: 'network' = sem resposta (sem internet, servidor fora); 'server' = o servidor respondeu com
 * erro (503 "muita gente procurando", 429, 5xx) — aí "confere tua internet" seria mentira
 */
export type NearbyFailKind = 'network' | 'server';

/** 'ok' = última busca deu certo; 'offline' = falhou e não tem lista; 'stale' = falhou mas a lista anterior segue */
export type NearbyNetState = 'ok' | 'offline' | 'stale';

/** `updatedAt` = quando a lista na tela chegou do servidor (ms); 0 = não tem lista */
export function nearbyNetState(isError: boolean, updatedAt: number): NearbyNetState {
  if (!isError) return 'ok';
  return updatedAt > 0 ? 'stale' : 'offline';
}

/** "atualizado há 3 min" — idade da lista, sem "agora" (a busca acabou de falhar) */
export function updatedAgo(updatedAt: number, now: number): string {
  const age = Math.max(0, now - updatedAt);
  if (age < MS_MIN) return 'atualizado há instantes';
  if (age < MS_HOUR) return `atualizado há ${Math.floor(age / MS_MIN)} min`;
  if (age < MS_DAY) return `atualizado há ${Math.floor(age / MS_HOUR)} h`;
  const days = Math.floor(age / MS_DAY);
  return `atualizado há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** título/dica do aviso sem lista, por motivo */
export function nearbyFailCopy(kind: NearbyFailKind): { emoji: string; title: string; hint: string } {
  return kind === 'server'
    ? { emoji: '⏳', title: 'Servidor ocupado agora', hint: 'Tenta de novo em instantes' }
    : { emoji: '📡', title: 'Sem conexão com o servidor', hint: 'Confere tua internet ou tenta daqui a pouco' };
}

/** rótulo discreto da sheet com a lista antiga: "sem conexão · atualizado há 3 min" */
export function nearbyStaleText(updatedAt: number, now: number, kind: NearbyFailKind = 'network'): string {
  return `${kind === 'server' ? 'servidor ocupado' : 'sem conexão'} · ${updatedAgo(updatedAt, now)}`;
}

/** o mesmo rótulo pro leitor de tela, com concordância ("lista atualizada há 3 min") */
export function nearbyStaleA11y(updatedAt: number, now: number, kind: NearbyFailKind = 'network'): string {
  const why = kind === 'server' ? 'Servidor ocupado' : 'Sem conexão com o servidor';
  return `${why}. Lista ${updatedAgo(updatedAt, now).replace('atualizado', 'atualizada')}`;
}

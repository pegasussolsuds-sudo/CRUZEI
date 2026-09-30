// GPS falso (GPS_GUARD): decide se uma posição recebida no POST /location/update pode virar a posição pública.
//
// Puro (sem Redis, sem banco): o GpsGuard (gps-guard.ts) lê/grava o estado e o LocationService aplica a decisão.
// Dois sinais:
//  - mocked: o Android diz que a posição veio de um app de GPS falso (LocationObject.mocked). O iOS não informa.
//  - velocidade: salto impossível desde a última posição ACEITA (âncora grosseira, ~110 m) e, acumulada, desde a
//    âncora da janela (posição aceita de alguns minutos atrás) — passinhos "plausíveis" seguidos não deslizam a posição.
//    Quem viajou de verdade (ou o GPS que voltou depois de um pulo) é aceito quando a posição nova se repete por
//    GPS_GUARD_CONFIRM_S.
//  - precisão: fix impreciso demais pra julgar (antena, localização aproximada) é ignorado — nem move nem conta strike.
// Limite conhecido: quem falsifica uma vez e fica parado >= CONFIRM_S passa na checagem de velocidade; só o mocked
// (ou atestação do aparelho, fora do escopo) pega esse caso.
import { distanceMeters } from '@cruzei/shared-utils';

export type GuardMode = 'off' | 'shadow' | 'on';

function envNum(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export function parseGuardMode(raw: string | undefined, def: GuardMode = 'on'): GuardMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'off' || v === 'shadow' || v === 'on' ? v : def;
}

export const GPS_GUARD = {
  /** off = não checa; shadow = só conta o que faria (gps:shadow:<dia>) e aceita tudo; on = esconde e sinaliza */
  MODE: parseGuardMode(process.env.GPS_GUARD),
  /** velocidade máxima por terra (km/h) entre posições aceitas com menos de AIR_AFTER_S de intervalo */
  MAX_GROUND_KMH: envNum('GPS_GUARD_MAX_GROUND_KMH', 250),
  /** avião: a partir de AIR_AFTER_S de intervalo vale este limite (km/h) */
  MAX_AIR_KMH: envNum('GPS_GUARD_MAX_AIR_KMH', 1_000),
  AIR_AFTER_S: envNum('GPS_GUARD_AIR_AFTER_S', 1_800),
  /** piso de ruído (m, já descontada a precisão): abaixo disto nunca é salto, em qualquer intervalo */
  NOISE_FLOOR_M: envNum('GPS_GUARD_NOISE_FLOOR_M', 300),
  /** intervalo curto (s): abaixo disto, todo salto acima do piso de ruído precisa de velocidade plausível */
  SHORT_DT_S: envNum('GPS_GUARD_SHORT_DT_S', 60),
  /** com intervalo >= SHORT_DT_S, salto abaixo disto (m, já descontada a precisão) é ruído de GPS/wi-fi */
  MIN_JUMP_M: envNum('GPS_GUARD_MIN_JUMP_M', 1_500),
  /** velocidade acumulada: a âncora da janela anda pra frente só depois de X s (posição aceita de alguns minutos atrás) */
  WINDOW_S: envNum('GPS_GUARD_WINDOW_S', 300),
  /** a precisão informada (das duas posições) desconta até isto da distância — mandar accuracy=100000 não compra salto */
  ACC_TOLERANCE_CAP_M: envNum('GPS_GUARD_ACC_TOLERANCE_CAP_M', 200),
  /**
   * precisão pior que isto (m): imprecisa demais pra julgar um salto (antena, localização aproximada) — nunca segura
   * nem conta strike; sem âncora vira a 1ª posição, com âncora só anda se plausível. Até aqui o erro honesto cabe no
   * piso de ruído + tolerância.
   */
  ACC_IGNORE_M: envNum('GPS_GUARD_ACC_IGNORE_M', 500),
  /** precisão assumida quando o app não manda (keep-alive antigo) */
  ACC_DEFAULT_M: envNum('GPS_GUARD_ACC_DEFAULT_M', 100),
  /** a posição nova (depois de um salto) vira a verdadeira se repetir por X s */
  CONFIRM_S: envNum('GPS_GUARD_CONFIRM_S', 45),
  /** episódios em 24 h que mandam a conta pra fila da moderação (sem banir nem esconder da descoberta por conta) */
  STRIKES_TELEPORT: envNum('GPS_GUARD_STRIKES_TELEPORT', 5),
  STRIKES_MOCK: envNum('GPS_GUARD_STRIKES_MOCK', 3),
  STRIKE_WINDOW_S: envNum('GPS_GUARD_STRIKE_WINDOW_S', 86_400),
  /** quanto tempo a pessoa fica escondida/sem ver ninguém depois do último aviso (um fix bom antes disso libera) */
  FLAG_TTL_S: envNum('GPS_GUARD_FLAG_TTL_S', 900),
  /** âncora e pendente (grosseiros) vivem isto (s): sem posição por 12 h, a próxima é aceita como primeira */
  STATE_TTL_S: envNum('GPS_GUARD_STATE_TTL_S', 12 * 3_600),
};

export type GuardConfig = Omit<typeof GPS_GUARD, 'MODE'>;

/** posição (a âncora/pendente guardadas são grosseiras, 3 casas ≈ 110 m); t em ms; acc em m */
export interface Fix {
  lat: number;
  lng: number;
  t: number;
  acc: number;
}

export type GuardFlag = 'mock' | 'teleport';

export interface GuardState {
  /** última posição ACEITA */
  anchor: Fix | null;
  /** âncora da janela: posição aceita de alguns minutos atrás (velocidade acumulada); null = sem janela ainda */
  win: Fix | null;
  /** posição nova depois de um salto, esperando confirmação */
  pending: Fix | null;
  /** aviso ativo (escondida por GPS falso agora) */
  flag: GuardFlag | null;
}

export interface MoveJudgement {
  ok: boolean;
  /** distância já descontada a precisão (m) */
  effM: number;
  kmh: number;
}

/** o movimento de `prev` pra `next` é fisicamente possível? */
export function judgeMove(prev: Fix, next: Fix, cfg: GuardConfig = GPS_GUARD): MoveJudgement {
  const d = distanceMeters(prev.lat, prev.lng, next.lat, next.lng);
  const tol = Math.min(Math.max(0, prev.acc) + Math.max(0, next.acc), cfg.ACC_TOLERANCE_CAP_M);
  const effM = Math.max(0, d - tol);
  const dtS = Math.max(1, (next.t - prev.t) / 1000);
  const kmh = (effM / dtS) * 3.6;
  // ruído de GPS/wi-fi: nunca é salto
  if (effM < cfg.NOISE_FLOOR_M) return { ok: true, effM, kmh };
  // salto médio com tempo de sobra é ruído (no máximo ~90 km/h); com intervalo curto, só com velocidade plausível
  if (effM < cfg.MIN_JUMP_M && dtS >= cfg.SHORT_DT_S) return { ok: true, effM, kmh };
  const limit = dtS >= cfg.AIR_AFTER_S ? cfg.MAX_AIR_KMH : cfg.MAX_GROUND_KMH;
  return { ok: kmh <= limit, effM, kmh };
}

/**
 * velocidade acumulada: desde a âncora da janela (alguns minutos atrás) a pessoa também precisa ter andado em velocidade
 * plausível — a tolerância da precisão desconta uma vez só, não a cada passinho. Sem janela (ou janela = âncora): ok.
 */
export function windowOk(state: GuardState, fix: Fix, cfg: GuardConfig = GPS_GUARD): boolean {
  if (!state.win || !state.anchor || state.win.t >= state.anchor.t) return true;
  return judgeMove(state.win, fix, cfg).ok;
}

export type AcceptReason = 'first' | 'ok' | 'confirmed';

/**
 * âncora da janela depois de aceitar `fix`: 1ª posição e viagem confirmada recomeçam no próprio fix; senão ela só anda
 * depois de WINDOW_S, e sempre pra âncora anterior (já aceita e checada) — nunca pro fix que acabou de chegar
 */
export function nextWindow(
  state: GuardState,
  fix: Fix,
  reason: AcceptReason,
  cfg: GuardConfig = GPS_GUARD,
): Fix {
  if (reason !== 'ok' || !state.anchor) return fix;
  if (!state.win || fix.t - state.win.t > cfg.WINDOW_S * 1000) return state.anchor;
  return state.win;
}

export type GuardDecision =
  /** vira a posição pública; a âncora passa a ser esta; pendente e aviso somem */
  | { action: 'accept'; reason: AcceptReason }
  /** não mexe em nada (posição inútil) */
  | { action: 'ignore'; reason: 'inaccurate' }
  /**
   * não vira a posição pública: esconde a presença e marca o aviso. `pending` = pendente novo a gravar (null = mantém o
   * que existe); `strike` = abre um episódio novo (conta pra fila da moderação)
   */
  | { action: 'hold'; reason: GuardFlag; pending: Fix | null; strike: GuardFlag | null };

/** decisão no modo 'on' (o modo shadow usa a mesma decisão só pra contar) */
export function decide(
  state: GuardState,
  fix: Fix,
  mocked: boolean,
  cfg: GuardConfig = GPS_GUARD,
): GuardDecision {
  // GPS falso declarado pelo sistema: nunca vira posição, nem pendente; um episódio por aviso (vale com qualquer precisão)
  if (mocked)
    return {
      action: 'hold',
      reason: 'mock',
      pending: null,
      strike: state.flag === 'mock' ? null : 'mock',
    };
  // imprecisa demais pra julgar um salto (antena, localização aproximada; NaN também): nunca segura nem conta strike.
  // Sem âncora vira a primeira (senão quem só libera a localização aproximada nunca aparece); com âncora só anda se o
  // movimento for plausível pelo mesmo critério (a tolerância tem teto, precisão ruim não compra salto) — senão fica
  if (!(fix.acc <= cfg.ACC_IGNORE_M)) {
    if (!state.anchor) return { action: 'accept', reason: 'first' };
    const judged = Number.isFinite(fix.acc) ? fix : { ...fix, acc: cfg.ACC_TOLERANCE_CAP_M };
    if (judgeMove(state.anchor, judged, cfg).ok && windowOk(state, judged, cfg))
      return { action: 'accept', reason: 'ok' };
    return { action: 'ignore', reason: 'inaccurate' };
  }
  if (!state.anchor) return { action: 'accept', reason: 'first' };
  // plausível desde a última aceita E desde a âncora da janela: senão a âncora não anda
  if (judgeMove(state.anchor, fix, cfg).ok && windowOk(state, fix, cfg))
    return { action: 'accept', reason: 'ok' };
  // salto impossível: vira verdade se a posição nova se repetir (coerente com o pendente) por CONFIRM_S
  if (state.pending && judgeMove(state.pending, fix, cfg).ok) {
    if (fix.t - state.pending.t >= cfg.CONFIRM_S * 1000)
      return { action: 'accept', reason: 'confirmed' };
    return { action: 'hold', reason: 'teleport', pending: null, strike: null };
  }
  // salto novo (ou pulando de um lugar pro outro): pendente novo e um episódio a mais
  return { action: 'hold', reason: 'teleport', pending: fix, strike: 'teleport' };
}

/** o que o servidor faz de fato em cada modo: off/shadow sempre aceitam; shadow devolve o que faria pra contar */
export function applyMode(
  mode: GuardMode,
  d: GuardDecision,
): { effective: GuardDecision; shadow: GuardDecision['reason'] | null } {
  if (mode === 'on' || d.action === 'accept') return { effective: d, shadow: null };
  return {
    effective: { action: 'accept', reason: 'ok' },
    shadow: mode === 'shadow' ? d.reason : null,
  };
}

/** limite de episódios em 24 h por tipo */
export function strikeLimit(kind: GuardFlag, cfg: GuardConfig = GPS_GUARD): number {
  return kind === 'mock' ? cfg.STRIKES_MOCK : cfg.STRIKES_TELEPORT;
}

/** texto da denúncia automática (vai pro painel): sem coordenada, sem lugar, sem horário exato */
export function autoReportText(kind: GuardFlag, count: number): string {
  return kind === 'mock'
    ? `Automático: localização simulada (GPS falso) detectada ${count} vezes em 24 h.`
    : `Automático: ${count} saltos impossíveis de posição em 24 h (possível GPS falso).`;
}

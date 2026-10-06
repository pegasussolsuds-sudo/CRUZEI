// Contrato das animações do avatar (danças, gestos, poses). Cada animação é um EmoteDef registrado em emotes/index.ts.
//
// Regras:
//   - `pose(k, t, v)` começa com 'worklet' e é pura (sem Math.random, sem estado): roda na thread de UI do palco,
//     no JS do mapa e em node (folha de contato). k = progresso 0..1 do ciclo, t = segundos desde o início, v = variação;
//   - ângulos em graus, positivo = horário na tela; use os campos novos (foreL/foreR, shinL/shinR, pet…) à vontade;
//   - a pose volta pra perto do neutro em k=0 e k=1 (o palco faz blend na entrada/saída e no loop);
//   - `keyK` = melhor quadro parado (miniatura do item e movimento reduzido);
//   - ATENÇÃO (plugin de worklets): cada função 'worklet' captura as funções que chama NO MOMENTO EM QUE É DEFINIDA.
//     Helper 'worklet' tem de vir ANTES de quem usa no arquivo (senão: "x is not a function" na thread de UI e no jest).

import type { Pose, PoseVariation } from '../pose';

/** âncoras de onde as partículas saem (o palco calcula a posição na tela a cada quadro) */
export type EmoteAnchor = 'mouth' | 'handL' | 'handR' | 'head' | 'chest' | 'pet' | 'feet' | 'above';

export type EmoteFxKind = 'hearts' | 'kiss' | 'notes' | 'sparkles' | 'confetti' | 'stars' | 'bubbles' | 'flash' | 'fireworks' | 'haha' | 'petals';

export interface EmoteFx {
  kind: EmoteFxKind;
  from: EmoteAnchor;
  /** janela do efeito no progresso 0..1 */
  start: number;
  end: number;
  /** partículas por segundo */
  rate: number;
  /** cor (hex); ausente = paleta do efeito */
  color?: string;
}

/** troca de expressão no tempo: entre `from` e `to` (progresso 0..1) o rosto vira `face` (id do slot face) */
export interface EmoteFace {
  from: number;
  to: number;
  face: string;
}

export interface EmoteDef {
  /** id do item no catálogo (slot `emote`) */
  id: string;
  /** segundos de um ciclo */
  dur: number;
  /** danças repetem; gestos tocam uma vez */
  loop: boolean;
  /** a animação mexe nos braços (a cena não põe as mãos no volante/guidão/colo por cima) */
  usesArms: boolean;
  /** a animação mexe nas pernas */
  usesLegs: boolean;
  /** pose no progresso k (0..1) — 'worklet' */
  pose: (k: number, t: number, v: PoseVariation) => Pose;
  /** trocas de expressão */
  face?: EmoteFace[];
  /** objeto mostrado durante a animação (id do slot `held`: 'guitar', 'mic', 'tambourine', 'wand'…) */
  prop?: string;
  /** partículas */
  fx?: EmoteFx[];
  /** só faz sentido com pet (o editor avisa) */
  needsPet?: boolean;
  /** progresso do melhor quadro parado (miniatura, movimento reduzido) */
  keyK: number;
}

export type EmoteRegistry = Record<string, EmoteDef>;

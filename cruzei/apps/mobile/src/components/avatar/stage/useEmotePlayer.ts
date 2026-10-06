// Controle de reprodução da animação do palco (estado React só nas transições; o progresso é um SharedValue que o
// palco escreve na thread de UI, sem re-render por quadro).
//
// Uso:
//   const player = useEmotePlayer();
//   <AvatarStage config={cfg} size={320} emote="wave" {...player.stageProps} />
//   <Botão onPress={player.toggle} rótulo={player.playing ? 'Pausar' : 'Tocar'} />

import { useCallback, useMemo, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

export interface EmotePlayer {
  /** tocando agora */
  playing: boolean;
  /** progresso 0..1 do ciclo atual (escrito pelo palco) */
  progress: SharedValue<number>;
  play: () => void;
  pause: () => void;
  /** recomeça do início e toca */
  replay: () => void;
  toggle: () => void;
  /** muda a cada replay (o palco recomeça quando muda) */
  replayToken: number;
  /** props prontas pro <AvatarStage/> */
  stageProps: { playing: boolean; replayToken: number; onEmoteEnd: () => void; progress: SharedValue<number> };
}

export function useEmotePlayer(autoplay = false): EmotePlayer {
  const [playing, setPlaying] = useState(autoplay);
  const [replayToken, setReplayToken] = useState(0);
  const progress = useSharedValue(0);
  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const replay = useCallback(() => {
    setReplayToken((t) => t + 1);
    setPlaying(true);
  }, []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const onEmoteEnd = useCallback(() => setPlaying(false), []);
  const stageProps = useMemo(() => ({ playing, replayToken, onEmoteEnd, progress }), [playing, replayToken, onEmoteEnd, progress]);
  return { playing, progress, play, pause, replay, toggle, replayToken, stageProps };
}

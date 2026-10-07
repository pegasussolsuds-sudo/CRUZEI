// Avatar vivo das telas grandes (perfil, prévia no mapa, cartão, match): o palco Skia (<AvatarStage/>) PARADO, com o
// fundo e a placa de pronomes quando a pessoa escolheu, e a animação assinatura (signature.ts) tocando uma vez no toque —
// ou ao abrir, com `autoplay`, se não houver movimento reduzido. Parado, o canvas não redesenha nada (a aura e o fundo
// mostram o quadro parado e só se mexem enquanto a animação toca). Dança também toca UM ciclo (loop={false}, igual ao
// mapa): em loop o relógio, a aura e as partículas ficavam vivos pra sempre. Listas e miniaturas: <CruzeiAvatar/>.
// `paused` congela o palco (tela sem foco): no Moto g54, canvas Skia animando atrás de outra tela já derrubou o HWUI.

import type { AvatarConfig } from '@cruzei/shared-types';
import * as Haptics from 'expo-haptics';
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { signatureEmote } from './signature';
import { AvatarStage, useEmotePlayer } from './stage';

export interface SignatureAvatarProps {
  config: AvatarConfig;
  /** altura do palco no full (largura = 0,8 × size); lado no busto */
  size: number;
  mode?: 'full' | 'bust';
  /** toca a assinatura uma vez ao montar (nunca com movimento reduzido nem pausado) */
  autoplay?: boolean;
  /** espera antes do autoplay (ms): deixa a tela/folha terminar de entrar */
  autoplayDelay?: number;
  /** congela o palco (tela fora de foco) */
  paused?: boolean;
  /** fundo da config (padrão: liga) */
  showBackdrop?: boolean;
  /** placa de pronomes (padrão: liga) */
  showPronouns?: boolean;
  groundShadow?: boolean;
  /** respiração contínua (padrão desligada: tela parada = zero quadros). Ligada, o palco redesenha todo quadro */
  idle?: boolean;
  /** quem é, pro leitor de tela (ex.: "Avatar de Ana"); o botão avisa que o toque anima */
  label: string;
  style?: StyleProp<ViewStyle>;
}

function SignatureAvatarInner({
  config,
  size,
  mode = 'full',
  autoplay = false,
  autoplayDelay = 350,
  paused = false,
  showBackdrop = true,
  showPronouns = true,
  groundShadow,
  idle = false,
  label,
  style,
}: SignatureAvatarProps) {
  const reduce = useReducedMotion();
  const emote = useMemo(() => signatureEmote(config), [config]);
  const player = useEmotePlayer();
  const { replay } = player;

  // autoplay: uma vez por montagem (quem monta de novo por pessoa é a tela, com key)
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !autoplay || reduce || paused || !emote) return;
    // marca só quando dispara: se pausar/navegar antes do tempo, a limpeza cancela e o autoplay tenta de novo depois
    const id = setTimeout(() => {
      autoDone.current = true;
      replay();
    }, autoplayDelay);
    return () => clearTimeout(id);
  }, [autoplay, reduce, paused, emote, replay, autoplayDelay]);

  const onPress = useCallback(() => {
    if (!emote) return;
    Haptics.selectionAsync().catch(() => {});
    replay();
  }, [emote, replay]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!emote}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={emote ? 'Toca a animação do avatar' : undefined}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
    >
      <AvatarStage
        config={config}
        size={size}
        mode={mode}
        emote={emote}
        {...player.stageProps}
        loop={false}
        showBackdrop={showBackdrop}
        showPronouns={showPronouns}
        groundShadow={groundShadow}
        paused={paused}
        idle={idle}
        decorative
      />
    </Pressable>
  );
}

export const SignatureAvatar = memo(SignatureAvatarInner);

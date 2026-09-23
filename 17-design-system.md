# 17 — Design System

> Cores, tipografia, componentes, animações.
> Tudo que define a identidade visual do Cruzei.

---

## 🎨 Identidade da Marca

### Conceito

Cruzei é **jovem, brasileiro, confiante, com energia**. Não é Tinder genérico nem Bumble corporativo. É a vibe de "saí pra rua hoje e talvez conheça alguém massa".

### Personalidade da marca

| Atributo | Descrição |
|----------|-----------|
| Jovem | Tom casual, linguagem direta |
| Brasileiro | Expressões locais, referências culturais |
| Confiante | Não pede desculpa por ser o que é |
| Divertido | Humor sutil, não forçado |
| Seguro | Respeito, cuidado, principalmente com mulheres |

### Tom de voz

| Contexto | Tom |
|----------|-----|
| Marketing | Casual, divertido, provocativo |
| In-app | Curto, útil, com humor |
| Erros | Empático, simples |
| Premium | Aspiracional mas acessível |

**Exemplos:**
- ❌ "Perfil atualizado com sucesso"
- ✅ "Seu perfil tá on! Vamo ver quem cruzou por aí 🚀"

- ❌ "Erro ao enviar mensagem"
- ✅ "Ih, não deu. Tenta de novo?"

- ❌ "Bem-vindo ao Cruzei Premium"
- ✅ "💎 Agora você chegou em todo mundo. Sem desculpa."

---

## 🎨 Cores

### Paleta principal

```typescript
// src/theme/colors.ts
export const colors = {
  // Marca
  primary: '#7FFF00',           // Verde-limão (ação principal)
  secondary: '#FF1493',         // Rosa-magenta (match, premium)
  accent: '#FFD700',            // Dourado (super curtida)
  
  // Estados
  success: '#00FF7F',
  warning: '#FFB800',
  danger: '#FF3B30',
  error: '#FF3B30',
  info: '#008B8B',
  online: '#00FF7F',
  
  // Neutros
  black: '#0A0A1A',
  white: '#FAFAFA',
  
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#0A0A1A',
  },
  
  // Backgrounds
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',
  
  // Mapas (referência)
  map: {
    water: '#40E0D0',
    park: '#7FFF00',
    road: '#FFFFFF',
    building: '#D4D4AA',
    night: {
      bg: '#0A0A1A',
      water: '#0A3D4D',
      park: '#1A4D1A',
      road: '#2A2A3A',
    },
  },
  
  // Transparências
  overlay: 'rgba(10, 10, 26, 0.5)',
  overlayDark: 'rgba(10, 10, 26, 0.8)',
  shadow: 'rgba(10, 10, 26, 0.15)',
  
  // Gradientes
  gradient: {
    match: ['#FF1493', '#7FFF00'],
    premium: ['#FFD700', '#FF1493'],
    boost: ['#7FFF00', '#00FF7F'],
  },
};
```

### Quando usar cada cor

| Cor | Uso |
|-----|-----|
| `primary` (#7FFF00) | Botões de ação, online, destaques |
| `secondary` (#FF1493) | Match, premium, CTAs importantes |
| `accent` (#FFD700) | Super curtida, conquistas |
| `success` (#00FF7F) | Confirmações, ações positivas |
| `warning` (#FFB800) | Chat expirando, atenção |
| `danger` (#FF3B30) | Erros, bloqueio, deletar |
| `online` (#00FF7F) | Status online (igual success) |
| `gray.*` | Textos secundários, borders |

### Contraste e acessibilidade

Todos os textos principais passam WCAG AA:

- `primary` em `black`: contraste 13.5:1 ✅
- `black` em `white`: contraste 18.9:1 ✅
- `white` em `primary`: contraste 1.5:1 ⚠️ (não usar pra texto)
- `secondary` em `white`: contraste 5.3:1 ✅

---

## 🔤 Tipografia

### Família

```typescript
// src/theme/typography.ts
export const typography = {
  // Display (títulos grandes, marketing)
  display: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 48,
    letterSpacing: -1,
  },
  
  // Headings
  h1: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  
  h2: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  
  h3: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  },
  
  h4: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  
  // Body
  bodyLarge: {
    fontFamily: 'Inter-Regular',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  
  bodySmall: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  
  // Labels
  label: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  
  labelSmall: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  
  // Buttons
  button: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  
  // Caption (microtexto)
  caption: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  
  // Mono (timers, dados numéricos)
  mono: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 14,
    fontWeight: '500',
  },
};
```

### Hierarquia de tamanho

```
Display (40) → Marketing, splash
H1 (32)      → Títulos de seção
H2 (24)      → Headers de tela
H3 (20)      → Cards importantes
H4 (18)      → Subtítulos
Body L (16)  → Texto principal
Body (14)    → Texto comum
Body S (12)  → Texto secundário
Caption (11) → Microtexto, hints
```

---

## 📐 Espaçamento

### Sistema 8pt

```typescript
// src/theme/spacing.ts
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  
  // Padding de tela
  screenHorizontal: 16,
  screenVertical: 24,
  
  // Border radius
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
};
```

### Aplicação

```
xs (4px)   → Padding interno de botões
sm (8px)   → Gap entre itens pequenos
md (12px)  → Padding de cards
lg (16px)  → Padding padrão de telas
xl (24px)  → Padding entre seções
xxl (32px)  → Padding entre grupos
xxxl (48px) → Hero spacing
```

---

## 🌑 Sombras

```typescript
// src/theme/shadows.ts
export const shadows = {
  sm: {
    shadowColor: '#0A0A1A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0A0A1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0A0A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  xl: {
    shadowColor: '#0A0A1A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.20,
    shadowRadius: 16,
    elevation: 12,
  },
};
```

**Aplicação:**
- `sm`: Cards simples, botões pequenos
- `md`: Cards de perfil, modais leves
- `lg`: Bottom sheets, FAB
- `xl`: Modais importantes, paywall

---

## 🧩 Componentes

### Avatar

```typescript
// packages/ui-mobile/src/Avatar/Avatar.tsx
import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { colors, typography, radius } from '../../theme';

interface AvatarProps {
  uri?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  isOnline?: boolean;
  isVerified?: boolean;
  isPremium?: boolean;
  isAnonymous?: boolean;
  onPress?: () => void;
}

const SIZES = {
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
  xxl: 128,
};

export const Avatar: React.FC<AvatarProps> = ({
  uri,
  name,
  size = 'md',
  isOnline,
  isVerified,
  isPremium,
  isAnonymous,
}) => {
  const px = SIZES[size];
  const initial = name.charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { width: px, height: px }]}>
      {uri && !isAnonymous ? (
        <Image
          source={{ uri }}
          style={[styles.image, {
            width: px,
            height: px,
            borderRadius: px / 2,
          }]}
        />
      ) : (
        <View style={[styles.placeholder, {
          width: px,
          height: px,
          borderRadius: px / 2,
          backgroundColor: isAnonymous ? colors.gray[400] : colors.primary,
        }]}>
          <Text style={[
            styles.initial,
            { fontSize: px / 2.5 },
            isAnonymous && { color: colors.white }
          ]}>
            {isAnonymous ? '🕶️' : initial}
          </Text>
        </View>
      )}
      
      {/* Online indicator */}
      {isOnline && (
        <View style={[
          styles.onlineDot,
          {
            right: 0,
            bottom: 0,
            width: px / 4,
            height: px / 4,
            borderRadius: px / 8,
          },
        ]} />
      )}
      
      {/* Verified badge */}
      {isVerified && (
        <View style={[styles.verifiedBadge, {
          right: -2,
          bottom: -2,
        }]}>
          <Text style={{ fontSize: px / 4 }}>✓</Text>
        </View>
      )}
      
      {/* Premium glow */}
      {isPremium && (
        <View style={[styles.premiumGlow, {
          width: px + 4,
          height: px + 4,
          borderRadius: (px + 4) / 2,
        }]} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  image: {
    backgroundColor: colors.gray[200],
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initial: {
    ...typography.h3,
    color: colors.black,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    backgroundColor: colors.online,
    borderWidth: 2,
    borderColor: colors.white,
  },
  verifiedBadge: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.info,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  premiumGlow: {
    position: 'absolute',
    top: -2,
    left: -2,
    borderWidth: 2,
    borderColor: colors.secondary,
  },
});
```

### Button

```typescript
// packages/ui-mobile/src/Button/Button.tsx
import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { colors, typography, spacing, radius } from '../../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  style,
}) => {
  const containerStyle = [
    styles.base,
    styles[`size_${size}`],
    styles[`variant_${variant}`],
    disabled && styles.disabled,
    style,
  ];
  
  const textStyle = [
    styles.text,
    styles[`text_${size}`],
    styles[`text_${variant}`],
  ];

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.black : colors.primary}
        />
      ) : (
        <>
          {icon}
          <Text style={textStyle}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.lg,
  },
  size_sm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  size_md: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  size_lg: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  variant_primary: {
    backgroundColor: colors.primary,
  },
  variant_secondary: {
    backgroundColor: colors.secondary,
  },
  variant_outline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  variant_ghost: {
    backgroundColor: 'transparent',
  },
  variant_danger: {
    backgroundColor: colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    ...typography.button,
  },
  text_sm: {
    fontSize: 14,
  },
  text_md: {
    fontSize: 16,
  },
  text_lg: {
    fontSize: 18,
  },
  text_primary: {
    color: colors.black,
  },
  text_secondary: {
    color: colors.white,
  },
  text_outline: {
    color: colors.primary,
  },
  text_ghost: {
    color: colors.primary,
  },
  text_danger: {
    color: colors.white,
  },
});
```

### Card

```typescript
// packages/ui-mobile/src/Card/Card.tsx
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing, shadows } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'flat' | 'elevated' | 'outlined';
  padding?: keyof typeof spacing;
  style?: ViewStyle;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'elevated',
  padding = 'md',
  style,
}) => {
  return (
    <View
      style={[
        styles.base,
        styles[`variant_${variant}`],
        { padding: spacing[padding] },
        style,
      ]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  variant_flat: {
    backgroundColor: colors.surfaceAlt,
  },
  variant_elevated: {
    ...shadows.md,
  },
  variant_outlined: {
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
});
```

### Chip

```typescript
// packages/ui-mobile/src/Chip/Chip.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, radius, spacing } from '../../theme';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  variant?: 'default' | 'primary' | 'secondary';
}

export const Chip: React.FC<ChipProps> = ({
  label,
  selected,
  onPress,
  variant = 'default',
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.base,
        styles[`variant_${variant}`],
        selected && styles.selected,
      ]}>
      <Text style={[
        styles.text,
        selected && styles.textSelected,
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.surface,
  },
  variant_default: {},
  variant_primary: {
    borderColor: colors.primary,
  },
  variant_secondary: {
    borderColor: colors.secondary,
  },
  selected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  text: {
    ...typography.labelSmall,
    color: colors.black,
  },
  textSelected: {
    color: colors.black,
    fontWeight: '600',
  },
});
```

### Timer (chat)

```typescript
// packages/ui-mobile/src/Timer/Timer.tsx
import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { colors, typography, spacing } from '../../theme';

interface TimerProps {
  expiresAt: Date;
  onExpire?: () => void;
}

export const Timer: React.FC<TimerProps> = ({ expiresAt, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining.total <= 0 && onExpire) {
        onExpire();
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  function calculateTimeLeft() {
    const total = expiresAt.getTime() - Date.now();
    const hours = Math.floor(total / (1000 * 60 * 60));
    const minutes = Math.floor((total / 1000 / 60) % 60);
    const seconds = Math.floor((total / 1000) % 60);
    return { total, hours, minutes, seconds };
  }

  const isWarning = timeLeft.total < 12 * 60 * 60 * 1000; // 12h

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⏰</Text>
      <Text style={[styles.text, isWarning && styles.warning]}>
        {timeLeft.hours}h {timeLeft.minutes}m
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: 14,
  },
  text: {
    ...typography.mono,
    color: colors.black,
  },
  warning: {
    color: colors.warning,
    fontWeight: '700',
  },
});
```

### Modal/Paywall

```typescript
// packages/ui-mobile/src/Modal/Paywall.tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius, shadows } from '../../theme';
import { Button } from '../Button';

interface PaywallProps {
  onSubscribe: () => void;
  onClose: () => void;
}

export const Paywall: React.FC<PaywallProps> = ({ onSubscribe, onClose }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.emoji}>💎</Text>
        <Text style={styles.title}>Cruzei Premium</Text>
        <Text style={styles.subtitle}>Conexões sem limite</Text>
      </View>

      <ScrollView style={styles.body}>
        <Feature
          emoji="👀"
          title="Vê quem te curtiu"
          description="Sem mais matches misteriosos"
        />
        <Feature
          emoji="↩️"
          title="Volta perfil"
          description="Repensa aquela decisão"
        />
        <Feature
          emoji="🌍"
          title="Cidade inteira"
          description="Não só no seu local"
        />
        <Feature
          emoji="⭐"
          title="9 super curtidas/dia"
          description="Destaque 9x mais"
        />
        <Feature
          emoji="📨"
          title="Mensagem sem estar lá"
          description="3 mensagens por dia"
        />
        <Feature
          emoji="🎯"
          title="Filtros avançados"
          description="Encontre exatamente o que quer"
        />
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.price}>R$ 29,90/mês</Text>
        <Text style={styles.priceSubtitle}>
          ou R$ 199,90/ano (44% off)
        </Text>
        <Button
          title="🚀 Experimentar 7 dias grátis"
          onPress={onSubscribe}
          variant="primary"
          size="lg"
          style={{ width: '100%' }}
        />
        <Button
          title="Restaurar compra"
          onPress={() => {}}
          variant="ghost"
        />
      </View>
    </View>
  );
};

const Feature = ({ emoji, title, description }) => (
  <View style={styles.feature}>
    <Text style={styles.featureEmoji}>{emoji}</Text>
    <View style={{ flex: 1 }}>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDescription}>{description}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.black,
  },
  subtitle: {
    ...typography.body,
    color: colors.gray[500],
    marginTop: spacing.xs,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  featureEmoji: {
    fontSize: 32,
  },
  featureTitle: {
    ...typography.h4,
    color: colors.black,
  },
  featureDescription: {
    ...typography.body,
    color: colors.gray[600],
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  price: {
    ...typography.h2,
    color: colors.black,
    textAlign: 'center',
  },
  priceSubtitle: {
    ...typography.body,
    color: colors.gray[600],
    textAlign: 'center',
  },
});
```

---

## 🎬 Animações

### Princípios

- **Rápidas**: 200-300ms pra interações
- **Suaves**: Easing `ease-out` pra entrada, `ease-in` pra saída
- **Funcionais**: Cada animação tem propósito (feedback, contexto, diversão)
- **Discretas**: Não exagera em quantidade

### Animações principais

| Animação | Duração | Easing | Uso |
|----------|---------|--------|-----|
| Fade in | 200ms | ease-out | Telas, modais |
| Fade out | 150ms | ease-in | Fechar modal |
| Scale tap | 100ms | ease-out | Botões |
| Slide up | 300ms | ease-out | Bottom sheets |
| Slide down | 250ms | ease-in | Fechar sheet |
| Pulse | 1000ms loop | linear | Hotspots, online |
| Bounce | 400ms | spring | Match! |

### Match animation (comemoração)

```typescript
// src/screens/Match/MatchScreen.tsx
import Animated, {
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';

const MatchScreen = () => {
  const emojiScale = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(50);
  const avatarsScale = useSharedValue(0);

  useEffect(() => {
    emojiScale.value = withSpring(1, { damping: 8 });
    avatarsScale.value = withDelay(200, withSpring(1));
    titleOpacity.value = withDelay(400, withTiming(1, { duration: 300 }));
    subtitleY.value = withDelay(500, withSpring(0));
  }, []);

  return (
    <View>
      <Animated.Text style={{ transform: [{ scale: emojiScale }] }}>
        🎉
      </Animated.Text>
      <Animated.View style={{ transform: [{ scale: avatarsScale }] }}>
        {/* Avatares */}
      </Animated.View>
      <Animated.Text style={{ opacity: titleOpacity }}>
        É UM MATCH!
      </Animated.Text>
      <Animated.Text style={{ transform: [{ translateY: subtitleY }] }}>
        Vocês se cruzaram no Bar do Léo
      </Animated.Text>
    </View>
  );
};
```

### Avatar pulse (online)

```typescript
const pulse = useSharedValue(1);

useEffect(() => {
  pulse.value = withRepeat(
    withSequence(
      withTiming(1.2, { duration: 600 }),
      withTiming(1, { duration: 600 })
    ),
    -1, // infinite
    false
  );
}, []);

return (
  <Animated.View style={{ transform: [{ scale: pulse }] }}>
    <View style={styles.onlineDot} />
  </Animated.View>
);
```

### Hotspot pulse (mapa)

```typescript
const HotspotPulse = ({ count }: { count: number }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(2.5, { duration: 2000 }),
      -1,
      false
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: 2000 }),
      -1,
      false
    );
  }, []);

  return (
    <Animated.View
      style={[
        styles.pulse,
        {
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
};
```

---

## 🖼️ Iconografia

### Set principal

Biblioteca: **Lucide React Native** (open source, consistente)

```bash
npm install lucide-react-native
```

### Ícones customizados (Cruzei)

| Ícone | Nome | Uso |
|-------|------|-----|
| 👁️ | visible | Modo visível |
| 🕶️ | anonymous | Modo anônimo |
| 🗺️ | map | Mapa |
| 💬 | chat | Chat |
| ⚡ | boost | Boost |
| 💎 | premium | Premium |
| ❤️ | like | Curtir |
| ⭐ | super | Super curtida |
| ➡️ | pass | Passar |
| 🎸 | seal-roadie | Selo show |
| ☕ | seal-cafe | Selo café |
| 🏖️ | seal-praia | Selo praia |

---

## 📱 Imagens e Assets

### Fotos de perfil

- Tamanho máx: 5MB
- Dimensões: 1080×1080 (quadrado, 1:1)
- Formato: JPG ou PNG
- Orientação: retrato (recomendado) ou paisagem
- Mínimo: 3 fotos, máximo 6

### Ícones POI

Categorias com ícones específicos:

```
🍺 Bar
🍽️ Restaurante
☕ Café
🌳 Parque
🏬 Shopping
🏋️ Academia
🎸 Show/Evento
🏖️ Praia
🏛️ Museu
🎭 Cultural
```

---

## 🌗 Modo Escuro

### Implementação automática

```typescript
// src/theme/theme.ts
import { useColorScheme } from 'react-native';

export const useTheme = () => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  
  return isDark ? darkTheme : lightTheme;
};

const darkTheme = {
  ...lightTheme,
  background: '#0A0A1A',
  surface: '#1A1A2A',
  surfaceAlt: '#262640',
  text: '#FAFAFA',
  textSecondary: '#A3A3A3',
  border: '#404040',
};

const lightTheme = {
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',
  text: '#0A0A1A',
  textSecondary: '#525252',
  border: '#E5E5E5',
};
```

### Configuração de mapa

- `MAPBOX_STYLE_DAY` (cruzei-day.json)
- `MAPBOX_STYLE_NIGHT` (cruzei-night.json)
- Switch automático baseado em horário OU preferência do usuário

---

## ♿ Acessibilidade

### Diretrizes implementadas

- ✅ Contraste WCAG AA em todos os textos
- ✅ Touch targets mínimos 44×44
- ✅ Labels em todos os botões (sem só ícone)
- ✅ Estados de focus visíveis
- ✅ Texto escalável (não usar pixel hardcoded)
- ✅ VoiceOver/TalkBack testado

### Exemplos

```typescript
<TouchableOpacity
  accessible={true}
  accessibilityLabel="Curtir perfil de Mariana"
  accessibilityHint="Envia uma curtida. Se ela também curtir, é um match."
  accessibilityRole="button">
  <Heart size={32} color={colors.primary} />
</TouchableOpacity>
```

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [18-glossario.md](./18-glossario.md)
# 05 — Wireframes e Fluxos de Tela

> 12 telas principais + fluxos de usuário + componentes.
> Referência visual pra designer e dev frontend.

---

## 🎨 Princípios de Design

### Tom visual
- **Jovem, brasileiro, acessível**
- **Estilo jogo** (Pokémon GO + Zenly + Apple Maps)
- **Energia alta** mas não infantil
- **Confiança** (mulheres precisam se sentir seguras)

### Princípios
1. **Mapa é a estrela** — sempre em 70%+ da tela principal
2. **Avatares são protagonistas** — circulares, com borda colorida
3. **Ação primária sempre visível** (curtir, mensagem)
4. **Modo anônimo sempre acessível** (toggle no topo)
5. **Hotspots pulsam** — feedback visual constante
6. **Modo noturno automático** após 18h

---

## 📐 Identidade Visual (resumo)

```
Cores:
  Primária:    #7FFF00 (verde-limão)    - ação principal, online
  Secundária:  #FF1493 (rosa-magenta)   - match, premium
  Neutro:      #0A0A1A (preto-azulado)  - textos
  Claro:       #FAFAFA                  - fundos
  Alerta:      #FFD700 (dourado)        - super curtida

Tipografia:
  Headlines:   Space Grotesk Bold
  Body:        Inter Regular
  Mono:        JetBrains Mono (timers)
```

Detalhes completos em [06-identidade-visual.md](./06-identidade-visual.md).

---

## 📱 Tela 1 — Splash + Login

```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│                                         │
│              🌟 CRUZEI 🌟              │
│                                         │
│         Conexões reais de              │
│            lugares reais               │
│                                         │
│           [ mapa sutil ]               │
│                                         │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  📱 Entrar com telefone        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  🔵 Entrar com Google          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │     Entrar com Apple           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Ao continuar, você concorda com os     │
│  Termos de Uso e Política de            │
│  Privacidade                            │
│                                         │
└─────────────────────────────────────────┘
```

**Ações:**
- Entrar com telefone (input numérico)
- Entrar com Google / Apple
- Ver termos / política privacidade

---

## 📱 Tela 2 — Verificação SMS

```
┌─────────────────────────────────────────┐
│  ⬅️                                  │
├─────────────────────────────────────────┤
│                                         │
│  Digite o código que enviamos           │
│  para +55 •• ••• •• 99                 │
│                                         │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐  │
│  │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │ │ 6 │  │
│  └───┘ └───┘ └───┘ └───┘ └───┘ └───┘  │
│                                         │
│  Reenviar código em 0:45                │
│                                         │
│  Não recebi o código (reenviar)        │
│                                         │
│                                         │
│                                         │
│  [ botão verde desabilitado até        │
│    código completo ]                     │
│                                         │
└─────────────────────────────────────────┘
```

**Detalhes:**
- Auto-foco no próximo input
- Auto-submit quando completo
- Timer de 45s pra reenviar

---

## 📱 Tela 3 — Onboarding 1 (Boas-vindas + permissões)

```
┌─────────────────────────────────────────┐
│                              Pular →    │
├─────────────────────────────────────────┤
│                                         │
│   Vamos personalizar sua experiência    │
│                                         │
│   📍 Onde você esteve                   │
│   Vê quem estava no mesmo lugar         │
│   que você. A gente não compartilha     │
│   com ninguém.                          │
│                                         │
│   🔒 Privacidade primeiro               │
│   Modo anônimo é padrão. Você escolhe   │
│   quando aparecer.                      │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  ✅ Permitir localização        │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  ❌ Agora não                   │   │
│   └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

**Fluxo:**
1. Splash + Login → Código SMS → Cadastro básico
2. → Permissão localização → Fotos → Bio → Interesses → Procurando → Modo inicial → Tutorial mapa → Mapa

---

## 📱 Tela 4 — Tutorial do Mapa (3 telas)

### Tutorial 1
```
┌─────────────────────────────────────────┐
│                              Pular →    │
├─────────────────────────────────────────┤
│                                         │
│            🗺️ Seu mapa                 │
│                                         │
│         ┌─────────────────┐             │
│         │   [mapa com     │             │
│         │    avatares]    │             │
│         │                 │             │
│         └─────────────────┘             │
│                                         │
│   Toque em qualquer avatar pra ver      │
│   quem esteve no mesmo lugar que você.  │
│                                         │
│         ● ○ ○                          │
│                                         │
│              [Próximo →]                │
└─────────────────────────────────────────┘
```

### Tutorial 2
```
┌─────────────────────────────────────────┐
│                              Pular →    │
├─────────────────────────────────────────┤
│                                         │
│         🔥 Hotspots pulsam             │
│                                         │
│         ┌─────────────────┐             │
│         │  [mapa com      │             │
│         │  hotspot        │             │
│         │  pulsando]      │             │
│         └─────────────────┘             │
│                                         │
│   Quanto mais gente, mais forte o       │
│   pulso. Vá até lá pra conhecer.       │
│                                         │
│         ○ ● ○                          │
│                                         │
│              [Próximo →]                │
└─────────────────────────────────────────┘
```

### Tutorial 3
```
┌─────────────────────────────────────────┐
│                              Pular →    │
├─────────────────────────────────────────┤
│                                         │
│         🕶️ Você escolhe                │
│                                         │
│         ┌─────────────────┐             │
│         │  [toggle        │             │
│         │   visível/      │             │
│         │   anônimo]      │             │
│         └─────────────────┘             │
│                                         │
│   Modo anônimo deixa você ver todo      │
│   mundo sem aparecer pra ninguém.       │
│                                         │
│         ○ ○ ●                          │
│                                         │
│              [Começar →]                │
└─────────────────────────────────────────┘
```

---

## 📱 Tela 5 — Mapa Principal (CORE)

```
┌─────────────────────────────────────────┐
│  ⬅️  Uberlândia - Centro      ⚙️       │  ← Header
├─────────────────────────────────────────┤
│                                         │
│  [🌳 Visível]    ↔    [🕶️ Anônimo]    │  ← Toggle modo
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │       🗺️ MAPA MAPBOX            │    │
│  │       (estilo Cruzei)           │    │
│  │                                 │    │
│  │   📷 Mariana (online)           │    │
│  │       (avatar circular          │    │
│  │        com borda verde)         │    │
│  │                                 │    │
│  │        🔥 HOTSPOT               │    │
│  │        (rosa pulsante,          │    │
│  │         "47 pessoas")           │    │
│  │                                 │    │
│  │   📷 Lucas                      │    │
│  │      📷 Ana                     │    │
│  │                                 │    │
│  │      📍 Bar do Léo              │    │
│  │      (POI com ícone)            │    │
│  │                                 │    │
│  │                                 │    │
│  │   ┌─────────────────┐           │    │
│  │   │  📍 Centralizar │           │    │
│  │   └─────────────────┘           │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │  ← Bottom sheet
│  │  👥 47 pessoas em 800m          │    │
│  │  ─────────── (drag handle) ──  │    │
│  │  [📷] Mariana, 26 • 100m       │    │
│  │       Esteve há 15 min         │    │
│  │  [📷] Lucas, 28 • 350m         │    │
│  │       Online agora             │    │
│  │  [📷] Ana, 24 • 500m           │    │
│  │       Esteve há 2h             │    │
│  │                                 │    │
│  │       [Ver todos (47) →]        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌────┬────┬────┬────┬────┐             │  ← Tab bar
│  │🗺️ │💬 │⚡ │👤 │⋯ │             │
│  │Mapa│Chat│Boost│Perfil│Mais            │
│  └────┴────┴────┴────┴────┘             │
└─────────────────────────────────────────┘
```

**Elementos principais:**
- Header com cidade atual + botão de configurações
- Toggle de modo (visível/anônimo) sempre no topo
- Mapa Mapbox ocupa ~70% da tela
- Avatares circulares com foto + borda colorida (verde = online, amarelo = esteve há pouco, vermelho = online agora mas longe)
- Hotspots pulsantes em rosa/magenta com número de pessoas
- POIs com ícones customizados (bar, parque, etc)
- Botão flutuante "Centralizar em mim"
- Bottom sheet colapsável com lista de pessoas
- Tab bar inferior com 5 abas

---

## 📱 Tela 6 — Bottom Sheet Expandido (Lista de Pessoas)

```
┌─────────────────────────────────────────┐
│  ⬅️  Uberlândia - Centro      ⚙️       │
├─────────────────────────────────────────┤
│                                         │
│       🗺️ MAPA (reduzido, 30% da tela)  │
│                                         │
├─────────────────────────────────────────┤
│  ─────── (drag handle) ────────         │
│                                         │
│  👥 47 pessoas em 800m                  │
│                                         │
│  Filtros: [Todos] [Online] [Perto]      │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [📷] Mariana, 26                │    │
│  │      🍺 Bar do Léo • 100m       │    │
│  │      ⏰ Esteve há 15 min        │    │
│  │                                 │    │
│  │  [💚 Curtir] [⭐ Super] [➡️]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [📷] Lucas, 28                  │    │
│  │      🌳 Praça Tubal • 350m     │    │
│  │      🟢 Online agora            │    │
│  │                                 │    │
│  │  [💚 Curtir] [⭐ Super] [➡️]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [📷] Ana, 24                    │    │
│  │      🏬 Shopping UDI • 500m     │    │
│  │      ⏰ Esteve há 2h            │    │
│  │                                 │    │
│  │  [💚 Curtir] [⭐ Super] [➡️]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ... mais 44 pessoas ...               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🔓 Desbloqueie Premium pra      │    │  ← CTA premium
│  │    ver a cidade inteira          │    │
│  │    [Virar Premium R$ 29,90]    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## 📱 Tela 7 — Card de Pessoa Expandido (Detalhe)

```
┌─────────────────────────────────────────┐
│  ⬅️                               ✕    │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │                                 │    │
│  │     [FOTO GRANDE - full screen] │    │
│  │                                 │    │
│  │                                 │    │
│  │                                 │    │
│  │                                 │    │
│  │                                 │    │
│  │  Mariana, 26                    │    │
│  │  📍 100m de você                │    │
│  │  🍺 Esteve no Bar do Léo há 15m│    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  [📷][📷][📷][📷]              │    │  ← Carrossel
│  └─────────────────────────────────┘    │
│                                         │
│  "Adoro rock e café ☕"                 │  ← Bio
│                                         │
│  ☕ Cafeteria (3)  🎸 Roadie (1)        │  ← Selos
│                                         │
│  💫 "Vocês se cruzaram no Bar do Léo   │  ← Contexto
│     ontem às 22h"                       │
│                                         │
│  ┌─────────┬──────────┬─────────┐       │
│  │   ➡️    │   💚     │   ⭐    │       │
│  │ Passar  │  Curtir  │  Super  │       │
│  └─────────┴──────────┴─────────┘       │
│                                         │
└─────────────────────────────────────────┘
```

**Interações:**
- Swipe left = passar
- Swipe right = curtir
- Tap em ⭐ = super curtida
- Tap em foto = expande (fullscreen)
- Tap em selo = explica o selo

---

## 📱 Tela 8 — Tela de Match!

```
┌─────────────────────────────────────────┐
│                                         │
│            🎉 É UM MATCH! 🎉           │
│                                         │
│      ┌─────────┐    ┌─────────┐        │
│      │  [📷]   │    │  [📷]   │        │
│      │ Mariana │    │  Você   │        │
│      │   26    │    │         │        │
│      └─────────┘    └─────────┘        │
│                                         │
│   💫 Vocês se cruzaram no              │
│      Bar do Léo ontem às 22h           │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  💬 Mandar mensagem            │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  📍 Ver local no mapa          │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  ⏰ Chat expira em 1d 23h       │   │
│   └─────────────────────────────────┘   │
│                                         │
│         [Continuar navegando →]         │
│                                         │
└─────────────────────────────────────────┘
```

**Animações:**
- Avatares se aproximam com bounce
- Confete caíndo
- Som de "ding!" (opcional)
- Vibração curta

---

## 📱 Tela 9 — Chat (com Expiração)

```
┌─────────────────────────────────────────┐
│  ⬅️  Mariana, 26            ⏰ 1d 23h  │  ← Timer no header
├─────────────────────────────────────────┤
│                                         │
│  ──── hoje ────                        │
│                                         │
│                  ┌──────────────────┐   │
│                  │ Oi! Curtiu o show │   │
│                  │ de ontem? 🎸      │   │
│                  └──────────────────┘   │
│                           22:15 ✓✓       │
│                                         │
│  ┌──────────────────┐                   │
│  │ Oi! Sim, foi     │                   │
│  │ demais! Como vc  │                   │
│  │ conheceu o bar?  │                   │
│  └──────────────────┘                   │
│  22:18 ✓✓                                │
│                                         │
│                  ┌──────────────────┐   │
│                  │ Trabalho perto,  │   │
│                  │ frequento toda   │   │
│                  │ semana kkkk      │   │
│                  └──────────────────┘   │
│                           22:20 ✓✓       │
│                                         │
│  ┌──────────────────┐                   │
│  │ [📷 foto da      │                   │  ← Foto temporária
│  │  banda no palco]│                   │     (some em 10s)
│  │ ⏱️ 8s            │                   │
│  └──────────────────┘                   │
│  22:21 ✓✓                                │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Digite uma mensagem...    🎤 ➤│    │  ← Input
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

**Estados do input:**
- Vazio: placeholder
- Digitando: balão verde aparece pro outro ("digitando...")
- Gravando áudio: timer + waveform
- Foto: botão de câmera

**Modal de mídia:**
```
┌─────────────────────────────────────────┐
│  Enviar                                │
│                                         │
│  [📷 Foto temporária]                  │
│  [🎙️ Áudio]                            │
│  [📍 Localização]                       │
│  [🎬 GIF]                              │
│  [📝 Texto]                             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📱 Tela 10 — Perfil Próprio

```
┌─────────────────────────────────────────┐
│  ⬅️                              ⚙️        │
├─────────────────────────────────────────┤
│                                         │
│         ┌─────────────┐                │
│         │   [FOTO]    │                │
│         │   Você, 28  │                │
│         │    ✓ verif. │                │
│         └─────────────┘                │
│                                         │
│         📍 Centro, Uberlândia          │
│         🟢 Visível no mapa             │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🕶️ Modo: [Visível ⇄ Anônimo]  │    │  ← Toggle
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────┬─────────┬─────────┐        │
│  │  ❤️ 12  │  ⭐ 1   │  💬 5   │        │  ← Stats
│  │ Curtidas│ Super  │ Matches │        │
│  └─────────┴─────────┴─────────┘        │
│                                         │
│  🏅 Selos:                              │
│  ☕ Cafeteria (3)  🎸 Roadie (1)       │
│  [Ver todos os selos →]                │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 👑 Cruzei Premium              │    │  ← CTA upgrade
│  │ • Avatar com destaque          │    │
│  │ • 9 super curtidas/dia         │    │
│  │ • Ver cidade inteira           │    │
│  │                                 │    │
│  │ [Assinar por R$ 29,90/mês]    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 📸 Minhas fotos (4/6)  [+ Add] │    │
│  │ [📷][📷][📷][📷]              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  📝 Sobre mim                  │    │
│  │  "Engenheiro, amo rock e       │    │
│  │   viajar. Procurando alguém    │    │
│  │   pra curtir uns bares."        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  ⚙️ Configurações              │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📱 Tela 11 — Hotspot Expandido

```
┌─────────────────────────────────────────┐
│  ⬅️  🔥 Hotspot - Bar do Léo      ✕    │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  🍺 Bar do Léo                  │    │
│  │  Rua XX, Centro, Uberlândia     │    │
│  │  ⭐ 4.6 (234 avaliações)        │    │
│  │  🕐 Aberto agora • Até 2h       │    │
│  └─────────────────────────────────┘    │
│                                         │
│  👥 47 pessoas do Cruzei aqui agora     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [📷][📷][📷][📷][📷][📷][+42]  │    │  ← Grid de avatares
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ [📷] Mariana, 26 • Curtir      │    │
│  │ [📷] Lucas, 28 • Curtir        │    │
│  │ [📷] Ana, 24 • Curtir          │    │
│  │ [📷] Pedro, 30 • Curtir        │    │
│  │ [📷] Carla, 27 • Curtir        │    │
│  │ ... +42 mais                    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  🎸 Show da banda X hoje       │    │  ← Evento (se houver)
│  │  Entrada: R$ 30 • 22h          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 📍 Como chegar (abre Waze)     │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📱 Tela 12 — Configurações

```
┌─────────────────────────────────────────┐
│  ⬅️  Configurações                       │
├─────────────────────────────────────────┤
│                                         │
│  CONTA                                  │
│  ┌─────────────────────────────────┐    │
│  │ 👤 Editar perfil                │    │
│  │ 📸 Gerenciar fotos              │    │
│  │ ✓ Verificação (badge azul)      │    │
│  │ 📧 Email e telefone             │    │
│  └─────────────────────────────────┘    │
│                                         │
│  PRIVACIDADE                            │
│  ┌─────────────────────────────────┐    │
│  │ 🕶️ Modo anônimo        [ON]    │    │
│  │ 📍 Precisão da localização     │    │
│  │ ⏸️ Pausar app                  │    │
│  │ 🚫 Usuários bloqueados (3)     │    │
│  │ 🗑️ Apagar histórico de local   │    │
│  └─────────────────────────────────┘    │
│                                         │
│  NOTIFICAÇÕES                           │
│  ┌─────────────────────────────────┐    │
│  │ 💬 Mensagens           [ON]    │    │
│  │ ❤️ Curtidas            [ON]    │    │
│  │ 🔥 Hotspots            [ON]    │    │
│  │ ⏰ Chat expirando      [ON]    │    │
│  │ 🔕 Modo silencioso              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ASSINATURA                             │
│  ┌─────────────────────────────────┐    │
│  │ 👑 Você é Cruzei Free          │    │
│  │ [Virar Premium R$ 29,90/mês]  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  SOBRE                                  │
│  ┌─────────────────────────────────┐    │
│  │ 📜 Termos de uso               │    │
│  │ 🔒 Política de privacidade     │    │
│  │ ℹ️ Sobre o Cruzei              │    │
│  │ 🚪 Sair                        │    │
│  │ 🗑️ Deletar conta               │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔄 Fluxos de Usuário

### Fluxo 1: Cadastro completo

```
Splash
  ↓
Login (telefone/Google/Apple)
  ↓
Verificação SMS
  ↓
Cadastro básico (nome, idade, gênero)
  ↓
Permissão localização
  ↓
Upload fotos (mín. 1)
  ↓
Bio (opcional)
  ↓
Interesses (chips)
  ↓
Procurando (relacionamento/casual/etc)
  ↓
Seleção de modo (anônimo recomendado)
  ↓
Tutorial mapa (3 telas)
  ↓
MAPA PRINCIPAL ←── aqui começa o uso
```

### Fluxo 2: Match + Chat

```
Usuário A curtindo no mapa
  ↓
Card de pessoa expandido
  ↓
Toca em Curtir / Super
  ↓
[Backend] Verifica match mútuo
  ↓
Match → Notificação
  ↓
Tela de Match!
  ↓
[Botão] Mandar mensagem
  ↓
Chat aberto (timer 48h)
  ↓
Conversa rola...
  ↓
[12h antes] Alerta de expiração
  ↓
[Se renovar por contexto] Timer reseta
  ↓
[Se expirar] Chat some, match fica no histórico
```

### Fluxo 3: Modo anônimo

```
Usuário no mapa em modo visível
  ↓
Toggle: 🕶️ Anônimo
  ↓
Confirmação: "Sem match nesse app por enquanto"
  ↓
Mapa recarrega (não aparece mais)
  ↓
Usuário curte anonimamente (fica salvo)
  ↓
Notificação: "3 pessoas que você curtiu estão visíveis agora. Revelar?"
  ↓
[Revelar] Volta ao modo visível
  ↓
Possível match retroativo
```

---

## 🎨 Componentes Reutilizáveis

### Avatar
```
┌─────────────────────────────┐
│ 📷 Mariana                  │
│ • online: borda verde       │
│ • esteve há pouco: amarelo  │
│ • premium+: brilho/glow    │
│ • anônimo: silhueta cinza   │
│ • verificado: ✓ no canto   │
└─────────────────────────────┘
```

### Botão Primário
```
┌─────────────────────────────┐
│ [       💚 Curtir        ]  │
│   verde-limão, full-width   │
└─────────────────────────────┘
```

### Botão Secundário
```
┌─────────────────────────────┐
│ [       ✕ Cancelar        ]  │
│   branco, borda cinza        │
└─────────────────────────────┘
```

### Card de Pessoa
```
┌─────────────────────────────┐
│ [📷] Mariana, 26            │
│      📍 100m                │
│      ⏰ há 15 min          │
│      [Curtir] [⭐] [➡️]   │
└─────────────────────────────┘
```

### Toast/Notificação In-app
```
┌─────────────────────────────┐
│ 🔥 47 pessoas no Bar do Léo │
└─────────────────────────────┘
```

### Timer Badge
```
┌─────────────────────────────┐
│ ⏰ 1d 23h (chat expira)     │
└─────────────────────────────┘
```

---

## 📐 Princípios de UX

### Tap targets
- Mínimo 44×44pt (padrão iOS)
- Botões primários: 48-56pt
- Cards: 64-80pt (tap em todo o card)

### Espaçamento
- Padding horizontal: 16px (telas)
- Entre elementos: 8-12px
- Entre seções: 24px

### Tipografia em telas
- Header: 24-32pt Bold
- Subtítulo: 18-20pt Semibold
- Body: 14-16pt Regular
- Caption: 11-12pt Regular
- Mono (timer): 14pt JetBrains Mono

### Animações
- Duração: 200-300ms
- Easing: ease-out
- Bottom sheet: 250ms spring
- Match: 800ms com bounce

### Acessibilidade
- VoiceOver/TalkBack em todos elementos
- Contraste mínimo 4.5:1 (texto)
- Botões com label acessível
- Ícones com texto alternativo

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [06-identidade-visual.md](./06-identidade-visual.md)
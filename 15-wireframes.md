# 15 — Wireframes e Fluxos

> Mapa mental visual do app.
> Cada tela, cada interação, cada estado.

---

## 🎨 Identidade Visual (referência)

```
🎨 PALETA
   Primária:    #7FFF00 (verde-limão)    → ação principal, online
   Secundária:  #FF1493 (rosa-magenta)   → match, premium
   Accent:      #FFD700 (dourado)        → super curtida
   Neutros:     #0A0A1A, #FAFAFA, #999

🔤 TIPOGRAFIA
   Headlines:   Space Grotesk Bold
   Body:        Inter Regular
   Mono:        JetBrains Mono (timers, dados)
```

---

## 📱 Fluxo de Telas

```
┌──────────┐
│  Splash  │
└────┬─────┘
     ↓
┌────────────────┐
│  Onboarding    │ → Welcome (3 telas)
│   (5 telas)    │ → Permissões
│                │ → Cadastro
│                │ → Fotos
│                │ → Anônimo
└────┬───────────┘
     ↓
┌──────────┐
│ Login    │ → Telefone
│ (se não  │ → Código SMS
│ onboard) │
└────┬─────┘
     ↓
┌──────────────┐
│  Main App    │
│  (Tabs)      │
├──────────────┤
│ 🗺️ Mapa     │ ← Tela principal
│ 💬 Chat     │
│ ⚡ Boost    │
│ 👤 Perfil   │
│ ⋯ Mais      │
└──────────────┘
```

---

## 🗺️ Mapa (Tela Principal)

### Estado padrão

```
┌───────────────────────────────────────┐
│ ⬅️  Uberlândia - Centro    ⚙️      │ ← Header
├───────────────────────────────────────┤
│                                       │
│  [👁️ Visível]   ↔   [🕶️ Anônimo]    │ ← Toggle modo
│                                       │
│  ┌─────────────────────────────┐     │
│  │                             │     │
│  │      🗺️ MAPA MAPBOX         │     │
│  │                             │     │
│  │   👤 Mariana (online)       │     │
│  │          👤                 │     │
│  │   🔴 hotspot (47 pessoas)   │     │
│  │                             │     │
│  │                  👤 Lucas   │     │
│  │   👤 Ana                    │     │
│  │                             │     │
│  │  ┌──────────────┐          │     │
│  │  │ 🏪 Bar do    │          │     │
│  │  │ Léo (POI)    │          │     │
│  │  └──────────────┘          │     │
│  │                             │     │
│  │      ┌────────────┐        │     │
│  │      │ 📍 Central │        │     │
│  │      └────────────┘        │     │
│  └─────────────────────────────┘     │
│                                       │
│  ┌─────────────────────────────┐     │ ← Bottom sheet
│  │ 👥 47 pessoas em 800m        │     │
│  │ ──────────                  │     │
│  │ [👤] Mariana, 26 • 100m    │     │
│  │      Cruzou há 15 min       │     │
│  │ [👤] Lucas, 28 • 350m      │     │
│  │      Online agora           │     │
│  │ [👤] Ana, 24 • 500m        │     │
│  │      Cruzou há 2h           │     │
│  │                             │     │
│  │  [Ver todos (47) →]         │     │
│  └─────────────────────────────┘     │
│                                       │
│ ┌───┬───┬───┬───┬───┐               │
│ │🗺️│💬│⚡│👤│⋯ │                │
│ │Map│Cht|Boo|Perf|Mis│               │
│ └───┴───┴───┴───┴───┘               │
└───────────────────────────────────────┘
```

### Modo Anônimo Ativo

```
┌───────────────────────────────────────┐
│ ⬅️  Uberlândia - Centro    ⚙️      │
├───────────────────────────────────────┤
│                                       │
│  [👁️ Visível]   ↔   [🕶️ Anônimo ✓] │ ← Anônimo selecionado
│  🟢 Você está oculto do mapa         │
│                                       │
│  ┌─────────────────────────────┐     │
│  │                             │     │
│  │      🗺️ MAPA                │     │
│  │                             │     │
│  │   👤 Mariana                │     │
│  │                             │     │
│  │   🔴 hotspot (47 pessoas)   │     │
│  │                             │     │
│  │   👤 Lucas                  │     │
│  │                             │     │
│  └─────────────────────────────┘     │
│                                       │
│  ┌─────────────────────────────┐     │
│  │ ⚠️ Modo anônimo: sem match │     │
│  │ ✨ [Quero me revelar]        │     │
│  └─────────────────────────────┘     │
│                                       │
└───────────────────────────────────────┘
```

---

## 💬 Chat

```
┌───────────────────────────────────────┐
│ ⬅️  Mariana, 26          ⏰ 1d 23h  │ ← Timer
├───────────────────────────────────────┤
│                                       │
│              ┌──────────────────┐   │
│              │ Oi! Curti o show │   │
│              │ de ontem? 🎸     │   │
│              └──────────────────┘   │
│                      22:15           │
│                                       │
│  ┌──────────────────┐               │
│  │ Oi! Sim, foi     │               │
│  │ demais! Como vc  │               │
│  │ conheceu o bar?  │               │
│  └──────────────────┘               │
│  22:18                                │
│                                       │
│              ┌──────────────────┐   │
│              │ Trabalho perto,  │   │
│              │ frequento toda   │   │
│              │ semana kkk       │   │
│              └──────────────────┘   │
│                      22:20           │
│                                       │
│  ┌──────────────────┐               │
│  │ [📷 foto da      │               │ ← Foto temp
│  │  banda no palco] │               │
│  │ ⏱️ 8s             │               │
│  └──────────────────┘               │
│  22:21                                │
│                                       │
│  ┌─────────────────────────────┐    │
│  │ Digite mensagem...    🎤 ➤ │    │ ← Input
│  └─────────────────────────────┘    │
│                                       │
└───────────────────────────────────────┘
```

### Chat Expirado

```
┌───────────────────────────────────────┐
│  Mariana, 26          ⏰ Expirado    │
├───────────────────────────────────────┤
│                                       │
│  (sem mensagens)                      │
│                                       │
│  ┌─────────────────────────────┐    │
│  │  ⏰ Este chat expirou       │    │
│  │                             │    │
│  │  💎 Premium: Mande mensagem │    │
│  │  mesmo sem estar no local   │    │
│  │                             │    │
│  │  [🚀 Virar Premium]         │    │
│  │  [Continuar navegando]      │    │
│  └─────────────────────────────┘    │
│                                       │
└───────────────────────────────────────┘
```

---

## 👤 Perfil de Outra Pessoa

```
┌───────────────────────────────────────┐
│  ⬅️                            ✕    │
├───────────────────────────────────────┤
│                                       │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │     [FOTO GRANDE - full screen] ││
│  │                                 ││
│  │     Mariana, 26                 ││
│  │     📍 100m de você             ││
│  │     🕐 Esteve no Bar do Léo há 15 min│
│  │                                 ││
│  │  ┌─────────────────────────┐   ││
│  │  │ [📷] [📷] [📷]           │   ││
│  │  └─────────────────────────┘   ││
│  │                                 ││
│  │  "Adoro rock e café ☕"          ││
│  │                                 ││
│  │  ☕ Cafeteria  🎸 Roadie       ││
│  │                                 ││
│  │  💬 "Vocês se cruzaram no      ││
│  │     Bar do Léo ontem às 22h"   ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                       │
│  ┌─────────┬──────────┬─────────┐   │
│  │   ➡️    │   ❤️     │   ⭐    │   │
│  │ Passar  │  Curtir  │ Super   │   │
│  └─────────┴──────────┴─────────┘   │
│                                       │
└───────────────────────────────────────┘
```

---

## ✨ Match!

```
┌───────────────────────────────────────┐
│                                       │
│        🎉 É UM MATCH! 🎉            │
│                                       │
│      ┌─────────┐    ┌─────────┐      │
│      │  [👤]   │    │  [👤]   │      │
│      │ Mariana │    │  Você   │      │
│      │  26     │    │         │      │
│      └─────────┘    └─────────┘      │
│                                       │
│   📍 Vocês se cruzaram no            │
│      Bar do Léo ontem às 22h         │
│                                       │
│   ┌─────────────────────────────┐   │
│   │  💬 Mandar mensagem         │   │
│   └─────────────────────────────┘   │
│                                       │
│   ┌─────────────────────────────┐   │
│   │  📍 Ver local no mapa       │   │
│   └─────────────────────────────┘   │
│                                       │
│   ┌─────────────────────────────┐   │
│   │  ⏰ Chat expira em 1d 23h    │   │
│   └─────────────────────────────┘   │
│                                       │
│         [Continuar navegando]        │
│                                       │
└───────────────────────────────────────┘
```

---

## ⚡ Boost

```
┌───────────────────────────────────────┐
│  ⬅️  ⚡ Boost              ⚙️       │
├───────────────────────────────────────┤
│                                       │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │    ⚡ BOOST DE REVELAÇÃO        ││
│  │                                 ││
│  │    Seu avatar vai aparecer:    ││
│  │                                 ││
│  │    ✨ Maior no mapa             ││
│  │    ✨ Brilho pulsante           ││
│  │    ✨ Topo da lista             ││
│  │    ✨ Visível em 5km            ││
│  │                                 ││
│  │    Por 1 hora                   ││
│  │                                 ││
│  │    ─────────────────────────    ││
│  │    R$ 4,90                      ││
│  │                                 ││
│  │    [🚀 Ativar Boost]            ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 📊 Últimos boosts:             ││
│  │                                 ││
│  │ Última vez: 3 dias atrás        ││
│  │ Curtidas geradas: 23            ││
│  │ Matches: 2                      ││
│  └─────────────────────────────────┘│
│                                       │
└───────────────────────────────────────┘
```

### Boost Ativo

```
┌───────────────────────────────────────┐
│  ⚡ Boost ativo: 42min restantes     │
│                                       │
│  ┌─────────────────────────────┐    │
│  │   ✨ VOCÊ ESTÁ EM DESTAQUE  │    │
│  │                             │    │
│  │   👤👤👤 23 pessoas viram │    │
│  │   💕 12 curtidas novas     │    │
│  │   🎉 2 matches!             │    │
│  └─────────────────────────────┘    │
│                                       │
└───────────────────────────────────────┘
```

---

## 💎 Paywall

```
┌───────────────────────────────────────┐
│  ⬅️  💎 Cruzei Premium            ✕│
├───────────────────────────────────────┤
│                                       │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │     💎 CRUZEI PREMIUM           ││
│  │                                 ││
│  │  ✨ Vê quem te curtiu           ││
│  │  ↩️  Volta perfil pra revisar   ││
│  │  🌍 Vê cidade inteira          ││
│  │  ⭐ 9 super curtidas/dia       ││
│  │  📨 Manda msg sem estar lá      ││
│  │  🎯 Filtros avançados          ││
│  │  🚫 Sem anúncios               ││
│  │                                 ││
│  │  ┌─────────────────────────┐  ││
│  │  │ R$ 29,90/mês            │  ││
│  │  │ ou R$ 199,90/ano (44% off)│  ││
│  │  │                         │  ││
│  │  │ 7 dias grátis pra testar│  ││
│  │  └─────────────────────────┘  ││
│  │                                 ││
│  │  [🚀 Experimentar grátis]      ││
│  │                                 ││
│  │  [Restaurar compra]            ││
│  │                                 ││
│  │  ─────────────────────────     ││
│  │                                 ││
│  │  🔒 Cancele quando quiser      ││
│  │  📱 Cobrado via iTunes/Google  ││
│  │  🛡️ LGPD compliant            ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                       │
└───────────────────────────────────────┘
```

---

## 👤 Meu Perfil

```
┌───────────────────────────────────────┐
│  ⬅️                          ⚙️    │
├───────────────────────────────────────┤
│                                       │
│        ┌─────────────┐               │
│        │   [FOTO]    │               │
│        │   Você, 28  │               │
│        │  ✓ Verificado│               │
│        └─────────────┘               │
│                                       │
│  📍 Centro, Uberlândia               │
│  👁️ Visível no mapa                  │
│                                       │
│  ┌─────────────────────────────────┐│
│  │  👁️ Modo: [Visível ⇄ Anônimo]  ││
│  └─────────────────────────────────┘│
│                                       │
│  ┌────────┬────────┬────────┐        │
│  │ ❤️ 12  │ ⭐ 1   │ 💬 5   │        │
│  │ Curtida│ Super  │ Match  │        │
│  └────────┴────────┴────────┘        │
│                                       │
│  🎖️ Selos:                            │
│  ☕ Cafeteria (3)  🎸 Roadie (1)    │
│  [Ver todos os selos →]              │
│                                       │
│  ┌─────────────────────────────────┐│
│  │  💎 Cruzei Premium              ││
│  │  • Avatar com destaque          ││
│  │  • 9 super curtidas/dia         ││
│  │  • Ver cidade inteira           ││
│  │                                 ││
│  │  [Assinar por R$ 29,90/mês]    ││
│  └─────────────────────────────────┘│
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 📷 Minhas fotos (4/6) [+ Add]  ││
│  │ [📷][📷][📷][📷]              ││
│  └─────────────────────────────────┘│
│                                       │
└───────────────────────────────────────┘
```

---

## 🔐 Onboarding

### 1. Welcome

```
┌───────────────────────────────────────┐
│                                       │
│         (logo Cruzei)                 │
│                                       │
│     Quem você quase conheceu hoje?   │
│                                       │
│     Conexões reais de lugares reais. │
│                                       │
│     [🚀 Começar]                      │
│                                       │
│     Já tem conta? Entrar →           │
│                                       │
└───────────────────────────────────────┘
```

### 2. Permissões

```
┌───────────────────────────────────────┐
│                                       │
│         📍 Sua localização            │
│                                       │
│  Pra mostrar pessoas que estão      │
│  ou estiveram no mesmo lugar        │
│  que você.                            │
│                                       │
│  ✓ Ative o GPS pra começar           │
│  ✓ Mesmo com app fechado             │
│                                       │
│  [Permitir localização]              │
│                                       │
│  [Agora não]                          │
│                                       │
└───────────────────────────────────────┘
```

### 3. Cadastro

```
┌───────────────────────────────────────┐
│  ⬅️                                  │
├───────────────────────────────────────┤
│                                       │
│         Como você quer entrar?       │
│                                       │
│  ┌─────────────────────────────────┐│
│  │  📱  +55 34 9 9999-9999         ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                       │
│  Enviaremos um SMS com código de    │
│  verificação.                         │
│                                       │
│  [Enviar código]                     │
│                                       │
│  ──── ou ────                        │
│                                       │
│  [Continuar com Apple]               │
│  [Continuar com Google]              │
│                                       │
└───────────────────────────────────────┘
```

### 4. Código

```
┌───────────────────────────────────────┐
│  ⬅️                                  │
├───────────────────────────────────────┤
│                                       │
│         Verificar telefone           │
│                                       │
│  Enviamos código pra +55 34         │
│  9 9999-9999                          │
│                                       │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐      │
│  │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │      │
│  └───┘ └───┘ └───┘ └───┘ └───┘      │
│                                       │
│  Reenviar código em 0:23             │
│                                       │
└───────────────────────────────────────┘
```

### 5. Perfil básico

```
┌───────────────────────────────────────┐
│  ⬅️  Seu perfil (2/5)               │
├───────────────────────────────────────┤
│                                       │
│         Como podemos te chamar?     │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ Nome                            ││
│  └─────────────────────────────────┘│
│                                       │
│         Data de nascimento            │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ __ / __ / ____                  ││
│  └─────────────────────────────────┘│
│                                       │
│         Eu sou:                       │
│                                       │
│  ┌──────────┐ ┌──────────┐          │
│  │ Mulher   │ │ Homem    │          │
│  └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐          │
│  │ Não-bin. │ │ Outro    │          │
│  └──────────┘ └──────────┘          │
│                                       │
│         Buscando:                     │
│                                       │
│  ┌──────────┐ ┌──────────┐          │
│  │ Sério    │ │ Casual   │          │
│  └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐          │
│  │ Amizade  │ │ Network  │          │
│  └──────────┘ └──────────┘          │
│                                       │
│         [Continuar →]                 │
│                                       │
└───────────────────────────────────────┘
```

### 6. Fotos

```
┌───────────────────────────────────────┐
│  ⬅️  Adicione fotos (3/5)           │
├───────────────────────────────────────┤
│                                       │
│  ┌─────┐ ┌─────┐ ┌─────┐            │
│  │ +1  │ │ +2  │ │ +3  │            │
│  └─────┘ └─────┘ └─────┘            │
│  ┌─────┐ ┌─────┐                    │
│  │ +4  │ │ +5  │                    │
│  └─────┘ └─────┘                    │
│                                       │
│  Dicas pra boas fotos:               │
│  ✓ Mostre seu rosto                  │
│  ✓ Boa iluminação                    │
│  ✓ Variedade de ambientes            │
│  ✗ Evite óculos de sol               │
│                                       │
│  📸 Ou tire uma selfie agora         │
│                                       │
│  [Continuar →]                        │
│                                       │
└───────────────────────────────────────┘
```

### 7. Anônimo (decisão importante)

```
┌───────────────────────────────────────┐
│  ⬅️  Último passo (5/5)             │
├───────────────────────────────────────┤
│                                       │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │   🕶️ Como você quer começar?   ││
│  │                                 ││
│  │   [👁️ Visível] (recomendado)   ││
│  │   Você aparece no mapa e       ││
│  │   pode dar match               ││
│  │                                 ││
│  │   [🕶️ Anônimo]                ││
│  │   Você vê mas não aparece.     ││
│  │   Sem match até se revelar.    ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                       │
│  💡 Dica: Você pode mudar depois    │
│     nas configurações.               │
│                                       │
│  [👁️ Começar visível]               │
│  [🕶️ Começar anônimo]               │
│                                       │
└───────────────────────────────────────┘
```

---

## 🚨 Situações Especiais

### Bloqueio

```
┌───────────────────────────────────────┐
│                                       │
│  🚫 Bloquear Lucas?                  │
│                                       │
│  Lucas não vai mais:                  │
│  • Aparecer no seu mapa               │
│  • Ver seu perfil                     │
│  • Mandar mensagem                    │
│                                       │
│  [Confirmar bloqueio]                │
│  [Cancelar]                           │
│                                       │
└───────────────────────────────────────┘
```

### Denúncia

```
┌───────────────────────────────────────┐
│                                       │
│  🚩 Denunciar Lucas                   │
│                                       │
│  Motivo:                              │
│  ○ Assédio                            │
│  ○ Perfil falso                       │
│  ○ Spam                               │
│  ○ Foto inapropriada                  │
│  ○ Comportamento suspeito             │
│  ○ Outro                              │
│                                       │
│  ┌─────────────────────────────┐    │
│  │ Descreva o que aconteceu...  │    │
│  └─────────────────────────────┘    │
│                                       │
│  [Enviar denúncia]                    │
│  [Cancelar]                           │
│                                       │
└───────────────────────────────────────┘
```

### Emergência / Pânico

```
┌───────────────────────────────────────┐
│                                       │
│  🆘 EMERGÊNCIA                       │
│                                       │
│  Se você está em perigo:             │
│                                       │
│  [📞 Ligar 190 (Polícia)]           │
│  [📞 Ligar 180 (Mulher)]            │
│  [🚪 Sair do app]                   │
│                                       │
│  ─────────────────────────           │
│                                       │
│  Cruzei pode te proteger:           │
│                                       │
│  • Pausar seu perfil 7 dias          │
│  • Bloquear quem você denunciar      │
│  • Suporte humano imediato           │
│                                       │
│  [🚨 Acionar proteção]              │
│                                       │
└───────────────────────────────────────┘
```

---

## 🔄 Fluxo de Match (Detalhado)

```
┌─────────────────┐
│ User A curte    │
│ User B          │
└────────┬────────┘
         │
         ↓
   ┌──────────────────┐
   │ Verifica se já   │
   │ curtiu (DB)      │
   └────┬─────────────┘
        │
        ├── Não ──→ Salva like ──→ Retorna {is_match: false}
        │
        └── Sim ──→ Cria match ──→ Notifica ambos ──→ Abre chat
```

### Mensagens do sistema

**Ao dar match:**
```
🎉 É um match! Vocês se cruzaram no Bar do Léo ontem às 22h.
[Ver match] [Continuar]
```

**Ao renovar chat (visitaram mesmo local):**
```
⏰ Seu chat com Mariana foi renovado! Vocês se viram no Parque Villa-Lobos.
[Enviar mensagem]
```

**12h antes de expirar:**
```
⏰ Seu chat com Lucas expira em 12h. Envie uma mensagem pra renovar.
[Enviar]
```

**Ao expirar:**
```
⏰ Chat com Lucas expirou.
💎 Premium pode continuar conversas mesmo expiradas.
```

---

## 📋 Estados do Sistema

### Modo de visibilidade

| Estado | Vê outros | Aparece | Dá match | Recebe match | Chat |
|--------|-----------|---------|----------|--------------|------|
| 👁️ Visível | ✅ | ✅ | ✅ | ✅ | ✅ |
| 🕶️ Anônimo | ✅ | ❌ | ❌ | ❌ | ❌ |
| ⏸️ Pausado | ❌ | ❌ | ❌ | ❌ | ❌ |

### Premium

| Estado | Recursos |
|--------|----------|
| 🆓 Free | Base |
| 🥈 Premium | Tudo Free + extras |
| 🥇 Premium+ | Tudo Premium + exclusivos |

### Match

| Estado | Chat | Visível na lista |
|--------|------|------------------|
| 🟢 Ativo | ✅ (com timer) | ✅ |
| ⏰ Expirado | ❌ | ✅ (histórico) |
| 🚫 Unmatch | ❌ | ❌ |
| 🚫 Bloqueado | ❌ | ❌ |

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [16-pitch-deck.md](./16-pitch-deck.md)
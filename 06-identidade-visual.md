# 06 — Identidade Visual

> Logo, cores, tipografia, tom de voz.
> O Cruzei tem cara — esse documento define.

---

## 🌟 Nome e Tagline

### Nome: **Cruzei**
- Verbo no pretérito: "eu cruzei com você"
- Curto (6 letras), brasileiro, ativo
- Funciona em pt-BR e fácil de lembrar
- Como verbo: "Cruzei com gente incrível no Cruzei" → duplo sentido
- Como marca em app stores: cruzei.com disponível (verificar)

### Alternativas consideradas
| Nome | Vantagem | Desvantagem |
|------|----------|-------------|
| Cruzei | ✅ Curto, ativo | Pode confundir com "Cruzei" (susto) |
| OndeCruzei | Mais descritivo | Longo |
| QuaseConheci | Poético | Não é chamativo |
| Presença | Elegante | Genérico |
| Cruza | Curtíssimo | Pode soar como "cruzar" no sentido religioso |

**Decisão:** Cruzei (simples, memorável, brasileiro)

### Tagline principal
> **Quem você quase conheceu hoje.**

Explica o produto em uma frase. Evoca destino + descoberta.

### Tagline secundária
> **Conexões reais de lugares reais.**

Diferencial competitivo explícito: contexto, não aleatoriedade.

### Sub-taglines (por feature)
- "Seu mapa de encontros" (mapa)
- "Veja quem esteve no mesmo lugar" (presença)
- "Curta sem aparecer" (anônimo)
- "Cada lugar conta uma história" (selos)
- "Conexões com prazo pra acontecer" (chat 48h)

---

## 🎨 Logo

### Conceito
- **Símbolo:** Pin de mapa estilizado com pessoas dentro
- **Tipografia:** Space Grotesk Bold, letter-spacing -2%
- **Cor:** Verde-limão (#7FFF00) sobre fundo escuro

### Logo horizontal (preto)
```
    ╭─────╮
    │ 👥  │  CRUZEI
    │ 📍  │  Conexões reais
    ╰─────╯
```

### Logo horizontal (branco)
```
    ┌─────┐
    │ 👥  │  CRUZEI
    │ 📍  │  Conexões reais
    └─────┘
```

### Ícone (app icon)
- Pin de mapa branco com 2 silhuetas dentro
- Fundo: gradiente verde-limão → rosa-magenta
- Cantos arredondados (estilo iOS)

### Construção geométrica
```
     ┌────────┐
     │   ●   ●  │   ← 2 pessoas (cabeças)
     │  ╱│╲ │   │   → silhuetas humanas
     │ ╱ │ ╲╱   │
     │   ▼      │   ← pin de mapa
     └────────┘
```

### Variações
- Logo completo (símbolo + texto)
- Símbolo sozinho
- Símbolo em branco
- Símbolo em preto
- Favicon (apenas o pin)

---

## 🌈 Paleta de Cores

### Cores primárias

| Cor | Hex | RGB | Uso |
|-----|-----|-----|-----|
| **Verde-limão** | `#7FFF00` | 127, 255, 0 | Ação primária, online, destaques |
| **Rosa-magenta** | `#FF1493` | 255, 20, 147 | Match, premium, paixão |

### Cores secundárias

| Cor | Hex | Uso |
|-----|-----|-----|
| **Azul-petróleo** | `#008B8B` | Links, info, badges |
| **Dourado** | `#FFD700` | Super curtida, premium gold |
| **Vermelho-coral** | `#FF6B6B` | Alertas, hot |

### Cores neutras

| Cor | Hex | Uso |
|-----|-----|-----|
| **Preto-azulado** | `#0A0A1A` | Texto principal, fundo dark |
| **Off-white** | `#FAFAFA` | Fundo claro |
| **Cinza claro** | `#F5F5F5` | Cards, separadores |
| **Cinza médio** | `#999999` | Texto secundário |
| **Cinza escuro** | `#404040` | Texto em fundos claros |

### Cores de estado

| Estado | Cor | Hex |
|--------|-----|-----|
| Sucesso | Verde | `#00C853` |
| Erro | Vermelho | `#FF3B30` |
| Aviso | Amarelo | `#FFB800` |
| Info | Azul | `#008B8B` |
| Online | Verde-limão | `#7FFF00` |
| Visto há pouco | Amarelo | `#FFD700` |
| Offline | Cinza | `#999999` |

### Cores do mapa (Cruzei Day)

| Elemento | Hex | Inspiração |
|----------|-----|------------|
| Água | `#40E0D0` | Turquesa Pokémon |
| Parque | `#7FFF00` | Verde-limão |
| Estrada | `#FFFFFF` | Branco limpo |
| Rua primária | `#FFD700` | Dourado |
| Rodovia | `#FF6B6B` | Vermelho coral |
| Prédio | `#D4D4AA` | Bege quente |
| Fundo | `#E8F5E8` | Verde-claro pastel |

### Cores do mapa (Cruzei Night)

| Elemento | Hex | Inspiração |
|----------|-----|------------|
| Água | `#0A3D4D` | Azul-petróleo escuro |
| Parque | `#1A4D1A` | Verde-musgo |
| Estrada | `#2A2A3A` | Cinza-azulado |
| Rua primária | `#FF1493` | Rosa-neon |
| Rodovia | `#7FFF00` | Verde-neon |
| Prédio | `#1A1A2A` | Cinza-azulado escuro |
| Fundo | `#0A0A1A` | Preto-azulado |

### Gradientes

```css
/* Match (verde → rosa) */
background: linear-gradient(135deg, #7FFF00 0%, #FF1493 100%);

/* Premium (dourado → rosa) */
background: linear-gradient(135deg, #FFD700 0%, #FF1493 100%);

/* Boost (verde → azul-petróleo) */
background: linear-gradient(135deg, #7FFF00 0%, #00FF7F 100%);

/* Hotspot (rosa com glow) */
background: radial-gradient(circle, #FF1493 0%, rgba(255,20,147,0) 70%);
```

---

## ✍️ Tipografia

### Famílias

| Uso | Família | Peso | Observação |
|-----|---------|------|------------|
| Headlines | **Space Grotesk** | Bold (700) | Moderna, geométrica, ousada |
| Subtítulos | **Space Grotesk** | Semibold (600) | |
| Body | **Inter** | Regular (400) | Padrão web/mobile |
| Body ênfase | **Inter** | Semibold (600) | |
| Mono | **JetBrains Mono** | Regular (500) | Timers, dados |
| Botões | **Inter** | Semibold (600) | letter-spacing 0.3 |

### Escala tipográfica

| Token | Tamanho | Line height | Uso |
|-------|---------|-------------|-----|
| display | 40px | 48px | Splash, marketing |
| h1 | 32px | 40px | Títulos de tela |
| h2 | 24px | 32px | Seções |
| h3 | 20px | 28px | Subseções |
| h4 | 18px | 24px | Títulos de card |
| bodyLarge | 16px | 24px | Destaque de texto |
| body | 14px | 20px | Texto padrão |
| bodySmall | 12px | 16px | Texto secundário |
| label | 14px | 20px | Botões |
| caption | 11px | 14px | Microcopy |
| mono | 14px | 20px | Timers |

### Letter-spacing
- Headlines: -0.5% a -1% (mais apertado, moderno)
- Body: 0 (padrão)
- Botões: +0.3% (mais espaçado, legibilidade)

### Web fonts
Google Fonts: Space Grotesk + Inter + JetBrains Mono (todas gratuitas)

---

## 🗣️ Tom de Voz

### Personalidade da marca
- **Brasileiro** — fala como gente, não como empresa
- **Jovem** — sem ser infantil
- **Confiante** — sem ser arrogante
- **Acolhedor** — especialmente com mulheres
- **Direto** — sem rodeios

### Princípios de comunicação

| ✅ Faz | ❌ Não faz |
|--------|-----------|
| "Você passou por aqui?" | "O usuário cruzou sua trajetória" |
| "Curtiu? Manda oi" | "Inicie uma conversa" |
| "Bora tomar uma?" | "Agendar encontro presencial" |
| "Dá pra ver todo mundo" | "Visibilidade total de usuários" |
| "Tá todo mundo lá" | "Alta densidade de usuários" |
| "Chat com hora pra acabar" | "Mensagens com prazo de expiração" |
| "Anônimo sem medo" | "Modo de privacidade ativado" |
| "47 pessoas no bar" | "47 usuários ativos no estabelecimento" |

### Exemplos de microcopy

#### Onboarding
- "Bora começar? 📍"
- "Confia, a gente não compartilha nada"
- "Modo anônimo é pra quem quer ver sem aparecer"
- "Tá quase! Só mais uma coisinha"

#### Match
- "É um match! 🎉"
- "Vocês se cruzaram no Bar do Léo"
- "Manda aquela primeira mensagem 😉"

#### Anônimo
- "Quer ver sem aparecer?"
- "Tá curioso? Pode olhar tranquilo"
- "47 anônimos aqui no bar"

#### Erro
- "Ops, deu ruim. Tenta de novo?"
- "Sem conexão. A gente salva tudo, relaxa"

#### Sucesso
- "Boa! Foto salva"
- "Tá ali no mapa 👀"

### Voz nas redes sociais
- Resposta a comentário com humor sutil
- Provocação leve em trends
- Bastidores do produto
- Depoimentos de usuários (com permissão)

---

## 📸 Direção de Arte

### Estilo fotográfico
- **Natural**, sem pose
- **Luz** dourada (final de tarde, bares)
- **Pessoas reais**, diversos corpos/etnias
- **Lugares reais** (não stock photos)
- **Cores quentes** + saturação alta

### Filtros sugeridos
- Aumentar saturação +20%
- Sombras puxando pra magenta
- Highlights puxando pra dourado
- Black point não tão preto (charcoal)

### Estilo de ilustração
- Flat com textura sutil
- Cores da paleta Cruzei
- Pin de mapa, avatar, balão de chat, coração, hotspot
- Uso em empty states, onboarding, marketing

### Ícones
- **Estilo:** 2px stroke, rounded
- **Tamanho base:** 24px
- **Cor:** preto-azulado (`#0A0A1A`) ou branco
- **Biblioteca:** Lucide React + customizações

---

## 🎬 Animações

### Princípios
- **Propósito** — animar pra dar feedback, não por decoração
- **Curta** — máximo 300ms pra interações
- **Suave** — ease-out, nunca linear
- **Física** — springs em casos especiais (match, hotspot)

### Animações específicas

#### Hotspot pulsando
- Círculo externo expande de 0 a 100% em 1.5s
- Opacidade de 0.8 a 0 em paralelo
- Loop infinito
- Estilo "sonar"

#### Avatar match (2 avatares se aproximando)
- 2 círculos se movem pro centro em 600ms
- Escala de 0.8 a 1.2 e volta pra 1.0
- Bounce ao final

#### Bottom sheet
- Slide up em 250ms
- Spring back se arrastou além

#### Toggle visível/anônimo
- Crossfade de 200ms
- Slide lateral de 50px

#### Match confete
- 50 partículas caindo por 3s
- Cores da paleta

---

## 🎯 Identidade Visual por Contexto

### App Store
- Screenshot 1: Mapa com avatares coloridos + texto "Seu mapa de encontros"
- Screenshot 2: Match com contexto "Vocês se cruzaram no Bar do Léo"
- Screenshot 3: Modo anônimo com texto "Curta sem aparecer"
- Screenshot 4: Hotspot pulsando "47 pessoas no bar"
- Screenshot 5: Chat com timer "Conexões com hora pra acontecer"
- Screenshot 6: Selos "Cada lugar conta uma história"

### Site (futuro)
- Hero: mapa animado com avatares
- Headline: "Quem você quase conheceu hoje."
- CTA: "Baixar agora" (App Store + Google Play)
- Footer: links + redes sociais

### Redes sociais
- Padrão visual: fundo escuro (`#0A0A1A`) + texto verde-limão
- Cards: fundo claro com fotos
- Reels/TikToks: tela do app + narração

### Marketing impresso (OOH)
- Fundo preto
- Logo gigante verde-limão
- Texto curto: "Seu mapa de encontros"
- QR code pra baixar

---

## 🏷️ Aplicação da Marca

### Botões

#### Botão primário
```
┌─────────────────────────┐
│   💚   Curtir           │   ← fundo verde-limão
└─────────────────────────┘     texto preto-azulado
```

#### Botão premium
```
┌─────────────────────────┐
│   👑   Premium           │   ← fundo gradiente dourado→rosa
└─────────────────────────┘     texto branco
```

#### Botão secundário
```
┌─────────────────────────┐
│   ✕   Cancelar          │   ← fundo branco, borda cinza
└─────────────────────────┘     texto cinza escuro
```

### Cards

#### Card de pessoa
- Background branco
- Sombra leve
- Avatar circular grande
- Nome em negrito
- Distância e horário em cinza
- Botões na parte inferior

#### Card de match
- Background com gradiente (verde → rosa)
- Texto branco
- Centralizado
- Animação de entrada

### Badges

#### Verificado
- Bolinha azul-petróleo com ✓
- No canto do avatar

#### Premium
- Borda dourada com brilho
- Coroa 👑 no perfil

#### Selos
- Circular com ícone do local
- Cor baseada no tipo (praia = azul, café = marrom, etc)
- Aparece no perfil

---

## 📐 Espaçamento e Grid

### Sistema de espaçamento (base 4px)

| Token | Valor | Uso |
|-------|-------|-----|
| xs | 4px | Detalhes |
| sm | 8px | Entre elementos pequenos |
| md | 12px | Entre texto e ícone |
| lg | 16px | Entre seções |
| xl | 24px | Padding de tela |
| xxl | 32px | Separação grande |
| xxxl | 48px | Hero sections |

### Border radius

| Token | Valor | Uso |
|-------|-------|-----|
| sm | 8px | Botões pequenos |
| md | 12px | Botões padrão |
| lg | 16px | Cards |
| xl | 24px | Modais |
| full | 9999px | Avatares, badges circulares |

### Sombras
```css
/* Leve (cards normais) */
box-shadow: 0 2px 8px rgba(10, 10, 26, 0.08);

/* Média (hover, elevação) */
box-shadow: 0 4px 16px rgba(10, 10, 26, 0.12);

/* Forte (modais, popups) */
box-shadow: 0 8px 32px rgba(10, 10, 26, 0.16);
```

---

## 🌗 Tema Claro vs Escuro

### Tema Claro (default)
- Fundo: `#FAFAFA`
- Texto: `#0A0A1A`
- Cards: `#FFFFFF`
- Mapa: Cruzei Day

### Tema Escuro (noturno ou premium+)
- Fundo: `#0A0A1A`
- Texto: `#FAFAFA`
- Cards: `#1A1A2A`
- Mapa: Cruzei Night

### Switch automático
- 18h-6h: tema escuro automático (configurável)
- Premium+: pode forçar tema ao vivo

---

## 🛠️ Implementação Técnica

### Design tokens (CSS / JS)

```typescript
export const theme = {
  colors: {
    primary: '#7FFF00',
    secondary: '#FF1493',
    accent: '#FFD700',
    info: '#008B8B',
    // ...
  },
  typography: {
    h1: { fontSize: 32, fontWeight: '700' },
    body: { fontSize: 14, fontWeight: '400' },
    // ...
  },
  spacing: {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
  },
  radius: {
    sm: 8, md: 12, lg: 16, xl: 24, full: 9999,
  },
};
```

### Storybook (recomendado)
- Documentar todos os componentes
- Variantes (tema, estado, props)
- Facilita pra designers e devs

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [07-arquitetura-tecnica.md](./07-arquitetura-tecnica.md)
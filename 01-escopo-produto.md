# 01 — Escopo do Produto (PRD v1.0)

> Product Requirements Document
> Cruzei — Conexões reais de lugares reais

---

## 1. 🎯 Visão

Conectar pessoas que **compartilharam o mesmo espaço físico** num intervalo recente, transformando encontros casuais em matches com contexto real de vivência.

---

## 2. ❓ Perguntas de Produto

### Por que usar?
- Matches vêm com **contexto** ("vocês se cruzaram no Bar do Léo sábado às 22h") → primeira mensagem nunca mais é "oi"
- Mapa em tempo real gera **urgência e curiosidade** → retenção altíssima
- **Modo anônimo livre** elimina a barreira de exposição → mulheres e tímidos entram sem medo

### Para quem?
- Pessoas frustradas com matches sem contexto (Tinder, Bumble saturados)
- Exploradores da cena social local (bares, shows, parques)
- Tímidos que precisam de "modo observação" antes de se revelar
- Turistas e recém-chegados que querem conhecer gente da região

### O que é único?
- **Único app brasileiro** com mapa de presença estilo jogo (Pokémon GO + Zenly)
- **Único** que transforma geolocalização em match com narrativa de contexto
- **Único** com toggle anônimo livre sem custar funcionalidades de visualização

---

## 3. 👥 Personas

### Persona 1 — "Aline Aventureira" (primária)
- **Idade:** 24
- **Cidade:** São Paulo / Uberlândia
- **Trabalho:** Designer / Marketing
- **Frustração:** "Tinder é loteria, todo match morre no 'oi'. Quero gente que curte os mesmos lugares que eu."
- **Comportamento:** Vai a 2-3 bares por semana, shows, parques. Ativa no Instagram.
- **Meta no app:** Conhecer alguém pra sair junto, relacionamento ou casual
- **Medo:** Perder tempo com gente que não tem nada em comum

### Persona 2 — "Rafael Explorador"
- **Idade:** 28
- **Cidade:** Mudou de cidade há 6 meses
- **Trabalho:** Engenheiro
- **Frustração:** "Não conheço ninguém aqui, não sei onde sair"
- **Comportamento:** Usa mapa pra descobrir onde tem gente, vai em hotspot
- **Meta:** Fazer amigos e conhecer a cena local
- **Medo:** Se expor pra desconhecidos

### Persona 3 — "Camila Tímida"
- **Idade:** 32
- **Cidade:** Belo Horizonte
- **Trabalho:** Professora
- **Frustração:** "Tenho vergonha de aparecer em app de namoro. Gostaria de ver antes de ser vista."
- **Comportamento:** Fica em modo anônimo por dias, observa, só se revela quando sente confiança
- **Meta:** Encontrar alguém especial sem exposição forçada
- **Medo:** Stalking, assédio, julgamento

### Persona 4 — "Bruno Match-eu"
- **Idade:** 30
- **Cidade:** Rio de Janeiro
- **Trabalho:** Empreendedor
- **Frustração:** "Já testei todos os apps, todos os mesmos matches sem graça"
- **Comportamento:** Vai em evento da TAM, curte pelo contexto, topa sair rápido
- **Meta:** Namorar, mas com química real
- **Medo:** Mais um app que não funciona

---

## 4. ⚙️ Requisitos Funcionais

### 4.1 Autenticação
- [x] Cadastro por telefone (SMS code)
- [x] Login por telefone + código
- [x] Refresh token automático
- [x] Logout
- [x] Recuperação de senha (v2)

### 4.2 Onboarding
1. Splash + boas-vindas
2. Cadastro (telefone, nome, data nasc., gênero)
3. Permissões: localização, notificações, fotos
4. Fotos (mín. 1, máx. 6)
5. Bio (300 chars)
6. Interesses (chips)
7. Procurando (relacionamento / casual / amizade / network)
8. Seleção de modo inicial (anônimo recomendado)
9. Tutorial do mapa (3 telas interativas)

### 4.3 Perfil
- Foto principal
- Até 5 fotos extras
- Nome (apelido)
- Idade (calculada pela data de nasc.)
- Gênero, orientação
- Bio
- Interesses
- Procurando
- Selos conquistados
- Badge de verificação

### 4.4 Configurações de privacidade
- 🕶️ **Modo anônimo** (toggle)
- 📍 Precisão de localização (exata / raio 500m)
- ⏸️ Pausar app (1h, 8h, 24h, fim de semana)
- 🚫 Lista de bloqueio
- 👁️ Não mostrar para quem eu passei
- 🗑️ Apagar histórico de localização

### 4.5 Mapa (Tela Principal)
**Visual:** Mapa Mapbox com tema customizado "Cruzei Day/Night"

**Elementos:**
- Avatares circulares com foto (visíveis ou anônimos)
- Indicador online (bolinha verde)
- Hotspots pulsantes (rosa com nº de pessoas)
- POIs (bares, parques, shoppings) com ícones
- Bottom sheet com lista de pessoas próximas

**Ações:**
- Toque no avatar → card expandido
- Toque no hotspot → lista de pessoas naquele local
- Pinch to zoom → expande/raio
- Botão "centralizar em mim"
- Toggle de modo (visível/anônimo) sempre no topo

### 4.6 Sistema de Match

**Usuário Free:**
- ❤️ Curtir (1 por dia em cada pessoa, total ilimitado)
- ⭐ Super curtida (1 por dia — notificação prioritária)
- ➡️ Passar (sem limite)

**Usuário Premium (R$ 29,90/mês):**
- ❤️ Curtir (ilimitado)
- ⭐ Super curtida (9 por dia)
- ➡️ Passar
- ↩️ Voltar perfil (5/dia)
- 🌎 Ver cidade inteira
- ✉️ Mensagem sem estar no local (3/dia)

**Usuário Premium+ (R$ 49,90/mês):**
- Tudo do Premium
- 🗺️ Avatar visível no mapa com destaque
- 👀 Ver quem te curtiu (lista completa)
- 🚀 Boost de revelação (aparece no topo por 1h)
- 🎯 Filtros avançados
- ✉️ Mensagem sem estar no local (10/dia)
- 🔇 Sem anúncios

### 4.7 Fluxo de Match
1. Pessoa A curte Pessoa B
2. Pessoa B curte Pessoa A (voluntário ou match sugerido)
3. Notificação simultânea: "É um match! Vocês se cruzaram no Bar do Léo há 2h"
4. Chat liberado com timer de 48h
5. Renovação automática se ambos visitarem mesmo local em 72h

### 4.8 Chat
- Mensagens de texto (500 chars)
- 📸 Fotos temporárias (some em 10s)
- 🎙️ Áudios (máx. 60s)
- 📍 Enviar localização
- 🎬 GIFs (Giphy)
- 💬 Templates de primeira msg baseados no local em comum

**Expiração:**
- Timer visível no header: "⏰ Chat expira em 1d 14h"
- 12h antes: alerta "Renove enviando uma mensagem"
- Expirado: some pra ambos, match continua no histórico

### 4.9 Selos de Local (Gamificação)
| Selo | Requisito | Benefício |
|------|-----------|-----------|
| ☕ Cafeteria | 5 cafés diferentes | Filtro especial |
| 🏖️ Praieiro | 5 praias | Destaque mapa |
| 🎸 Roadie | 5 shows | Badge raro |
| 🍺 Boêmio | 10 bares | Match prioritário |
| 🌳 Natureza | 3 parques | Filtro eco |
| 🏙️ Urbanista | 5 shoppings | Match por marca |
| 💪 Fitness | 5 academias | Match fitness |
| 🎨 Cultural | 4 museis/culturais | Match cultural |

### 4.10 Notificações Push
**Tipos:**
- 💬 "47 pessoas estão no [Local] agora"
- 💕 "Você tem um novo match! Cruzaram no [Local]"
- 👁️ "[Nome] visitou seu perfil"
- ⏰ "Seu chat com [Nome] expira em 12h"
- ❤️ "[Nome] curtiu você no [Local] há 2h"

**Configurações por tipo + horário de silêncio + distância mínima**

---

## 5. 🎫 Tiers e Monetização

### 5.1 Assinaturas
| Recurso | Free | Premium | Premium+ |
|---------|:----:|:-------:|:--------:|
| Ver pessoas no local (5h) | ✅ | ✅ | ✅ |
| Chat (expira 48h) | ✅ | ✅ | ✅ |
| Curtir | ✅ | ✅ | ✅ |
| Super curtida | 1/dia | 9/dia | 9/dia |
| Voltar perfil | ❌ | ✅ | ✅ |
| Ver cidade inteira | ❌ | ✅ | ✅ |
| Msg sem estar no local | ❌ | 3/dia | 10/dia |
| Modo anônimo | ✅ | ✅ | ✅ |
| Avatar destaque no mapa | ❌ | ❌ | ✅ |
| Ver quem te curtiu | ❌ | Últimas 5 | Todas |
| Boost de revelação | ❌ | ❌ | ✅ |
| Sem anúncios | ❌ | ✅ | ✅ |
| Filtros avançados | ❌ | ✅ | ✅ |
| **Preço** | **R$ 0** | **R$ 29,90/mês** | **R$ 49,90/mês** |

### 5.2 Compras In-App
- 🚀 Boost único: R$ 4,90 (1h no topo)
- ⭐ Pacote 30 super curtidas: R$ 9,90
- 🕶️ Anônimo ilimitado: R$ 4,90/mês adicional (free só tem 24h contínuas)
- 🏅 Selos premium: R$ 1,90 cada
- 👑 Premium anual: R$ 199,90 (45% off)

### 5.3 Receita B2B (mês 6+)
- **Locais Patrocinados:** bares, restaurantes, eventos
- **API de presença anonimizada** pra prefeituras/marcas
- **Eventos oficiais** com selo "Parceiro Cruzei"

---

## 6. 📊 Modelo de Negócio

### 6.1 Unit Economics (estimativa mês 12)
| Métrica | Valor |
|---------|-------|
| Usuários ativos mensais | 250.000 |
| Conversão free → premium | 3% |
| Assinantes pagos | 7.500 |
| ARPU mensal | R$ 32 |
| MRR | R$ 240.000 |
| ARR | R$ 2.880.000 |
| CAC estimado | R$ 15 |
| LTV estimado | R$ 96 |
| LTV/CAC | 6.4 |

### 6.2 Payback
- **CAC:** ~R$ 15 (Instagram/TikTok orgânico)
- **LTV médio:** R$ 96 (assinante fica 3 meses em média)
- **Payback:** mês 8-10

---

## 7. 🚫 Fora do Escopo (v1)

- ❌ Videochat / chamada de voz
- ❌ Stories / feed social
- ❌ Grupos / comunidades
- ❌ Eventos criados por usuário
- ❌ Integração com calendário
- ❌ Tradução automática
- ❌ Compras com cripto
- ❌ Perfis pra empresas / marcas
- ❌ API pública
- ❌ Versão web

Esses ficam pra V2+ baseado em feedback dos usuários.

---

## 8. ⚠️ Restrições Críticas

### LGPD (obrigatório desde MVP)
- Opt-in explícito de localização
- Modo anônimo é default na instalação
- Retenção de 30 dias pra localizações
- Botão "apagar meus dados agora"
- DPO interno (mesmo que fundador com formação)

### Segurança
- Verificação por selfie (badge azul)
- Denúncia 1-toque
- Bloqueio reverso (não aparece pra quem te bloqueou)
- Moderação ativa de reports críticos

### Privacidade feminina
- Mulheres nunca aparecem "perto demais" sem opt-in
- Distância sempre aproximada (raio 500m), nunca exata
- Filtros automáticos anti-assédio

---

## 9. 📈 Métricas de Sucesso (MVP)

| Métrica | Meta MVP (3 meses) |
|---------|--------------------|
| Downloads | 5.000 |
| DAU/MAU | > 30% |
| Sessões/dia | 3+ |
| Matches/usuário/semana | 2+ |
| Mensagens/match | 4+ |
| Conversão free → premium | 2% |
| Churn D30 | < 12% |
| NPS | > 40 |

---

## 10. 🌍 Estratégia Geográfica

### Fase 1 — Beta (mês 1-3): Uberlândia/MG
- Cidade universitária, vida noturna intensa
- 700k habitantes, mercado não saturado
- Permite teste focado antes de escalar

### Fase 2 — Capitais do Sudeste (mês 4-6)
- SP, RJ, BH
- Foco em bairros: Vila Madalena, Pinheiros, Ipanema, Savassi
- Eventos com micro-influencers

### Fase 3 — Capitais regionais (mês 7-9)
- Floripa, Recife, Salvador, Curitiba, Brasília, Porto Alegre
- Marketing local + parcerias com bares

### Fase 4 — Nacional (mês 10-12)
- Todas as capitais + cidades médias estratégicas
- Programa de embaixadores universitários

---

## 11. 🛠️ Decisões Tomadas

| Item | Decisão | Justificativa |
|------|---------|---------------|
| Nome | **Cruzei** | Curto, brasileiro, ativa verbo |
| Mobile | React Native | 1 codebase iOS+Android |
| Backend | Node.js + NestJS + TypeScript | Estrutura sólida, escalável |
| Banco | PostgreSQL + PostGIS | Geolocalização nativa |
| Cache | Redis 7 | Presença, pub/sub, geohash |
| Mapa | Mapbox (custom) | Visual único estilo Pokémon GO |
| Beta | Uberlândia/MG | Cidade universitária |
| Geofencing | Background nativo (opção A) | Precisão alta |

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [02-pesquisa-mercado.md](./02-pesquisa-mercado.md)
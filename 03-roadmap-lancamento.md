# 03 — Roadmap de Lançamento

> 4 fases, 12 meses, do MVP ao MRR R$ 240k.
> Beta em Uberlândia/MG, escala nacional em ondas.

---

## 🎯 Visão Geral

| Fase | Período | Cidade | Meta |
|------|---------|--------|------|
| **Fase 1 — MVP** | Mês 1-2 | Uberlândia/MG | App funcional, 1.000 installs orgânicos |
| **Fase 2 — Beta** | Mês 3 | Uberlândia/MG | 5.000 MAU, validação de métricas |
| **Fase 3 — Lançamento** | Mês 4-6 | SP, RJ, BH, UDI | 50.000 MAU, monetização ativa |
| **Fase 4 — Escala** | Mês 7-12 | Nacional | 250.000 MAU, R$ 240k MRR |

---

## 📦 Fase 1: MVP (Mês 1-2)

**Objetivo:** Ter um app funcional com features core, sem monetização ainda. Validar que o produto funciona tecnicamente.

### Entregas técnicas

#### Semana 1-2: Fundação
- [ ] Setup do monorepo (frontend + backend + infra)
- [ ] CI/CD básico (GitHub Actions)
- [ ] Ambientes: dev, staging, prod
- [ ] Configurar Mapbox + keys
- [ ] Configurar Firebase (FCM, Auth)
- [ ] Setup PostgreSQL + Redis
- [ ] Deploy backend em staging (AWS/GCP)

#### Semana 3-4: Auth + Perfil
- [ ] Cadastro por telefone (SMS code via Firebase Auth)
- [ ] Login + refresh token
- [ ] Edição de perfil (nome, idade, gênero, bio, fotos)
- [ ] Upload de fotos (Cloudflare R2)
- [ ] Onboarding com 8 telas
- [ ] Tutorial do mapa

#### Semana 5-6: Mapa + Localização
- [ ] Mapa Mapbox com tema Cruzei
- [ ] Solicitar permissão
- [ ] Background location (60s foreground, 300s background)
- [ ] Enviar localização pro backend
- [ ] Ver avatares próximos (5h janela)
- [ ] Toggle visível/anônimo funcional
- [ ] Bottom sheet com lista de pessoas

#### Semana 7-8: Match + Chat básico
- [ ] Botão curtir / super curtida / passar
- [ ] Detecção de match mútuo
- [ ] Tela de match com contexto
- [ ] Chat básico (texto)
- [ ] Timer de expiração 48h
- [ ] Notificação de match (FCM)

### Métricas de saída da Fase 1
| Métrica | Meta |
|---------|------|
| App compila e roda | ✅ |
| Auth funciona (cadastro + login) | ✅ |
| Mapa carrega com avatares | ✅ |
| Match funciona end-to-end | ✅ |
| Chat com expiração | ✅ |
| Testes unitários > 60% | ✅ |
| Deploy em staging | ✅ |

### Riscos
- ⚠️ Mapbox pode demorar pra configurar
- ⚠️ Background location pode ter problemas de permissão no iOS
- ⚠️ SMS code pode falhar (custo + deliverability)

---

## 🧪 Fase 2: Beta Fechado (Mês 3)

**Objetivo:** Validar com 100-500 usuários reais em Uberlândia/MG. Coletar feedback, ajustar produto, validar métricas-chave.

### Estratégia de aquisição
- 100 usuários beta selecionados (universitários +早期 adopters)
- Grupo de WhatsApp/Telegram pra feedback
- Acesso antecipado + benefícios (premium grátis vitalício se converter)

### Entregas técnicas
- [ ] Selos básicos (Cafeteria, Praieiro, Roadie)
- [ ] Hotspots pulsantes (detecção de cluster)
- [ ] Verificação por selfie
- [ ] Denúncia e bloqueio
- [ ] Painel admin básico (moderação)
- [ ] Analytics (Mixpanel/Amplitude)
- [ ] A/B test infrastructure

### Entregas de produto
- [ ] Notificações push otimizadas (horário, frequência)
- [ ] Sistema de match sugerido
- [ ] Feedback in-app (NPS, NPS por feature)
- [ ] FAQ / help center
- [ ] Onboarding refinado

### Métricas de saída da Fase 2
| Métrica | Meta |
|---------|------|
| MAU em Uberlândia | **5.000+** |
| DAU/MAU | **> 30%** |
| Matches/usuário/semana | **> 2** |
| Mensagens/match | **> 4** |
| NPS | **> 40** |
| Taxa de match | **> 15%** |
| Churn D7 | **< 20%** |
| Verificados % | **> 30%** |

### Ações baseadas em feedback
- Se D7 baixo → investigar onboarding, ajustar primeiros passos
- Se matches baixos → ajustar algoritmo de proximidade/horário
- Se denúncias altas → reforçar moderação, ajustar filtros
- Se churn alto → melhorar retenção via notificações

---

## 🚀 Fase 3: Lançamento Público (Mês 4-6)

**Objetivo:** Lançar oficialmente nas lojas (App Store + Play Store). Atingir tração inicial. Começar monetização.

### Cidades-alvo
**Onda 1 (mês 4):** São Paulo, Rio de Janeiro
**Onda 2 (mês 5):** Belo Horizonte, Uberlândia (expansão)
**Onda 3 (mês 6):** Florianópolis, Recife, Salvador

### Entregas técnicas

#### Monetização
- [ ] Integração Stripe (web)
- [ ] Integração Apple IAP
- [ ] Integração Google Play Billing
- [ ] Validação de receipts
- [ ] Sistema de subscription management
- [ ] Trial de 7 dias (premium)

#### Features pagas
- [ ] Premium tier (R$ 29,90/mês)
- [ ] Premium+ tier (R$ 49,90/mês)
- [ ] Boost único (R$ 4,90)
- [ ] Pacote super curtidas (R$ 9,90)
- [ ] Premium anual (R$ 199,90)

#### Features de produto
- [ ] Modo anônimo ilimitado (premium)
- [ ] Ver quem te curtiu (premium+)
- [ ] Filtros avançados
- [ ] Mensagem sem estar no local
- [ ] Avatar premium com destaque no mapa
- [ ] Boost de revelação

### Marketing de lançamento

#### Pré-lançamento (mês 3-4)
- [ ] Landing page otimizada
- [ ] Lista de espera com +5k signups
- [ ] Press kit pronto
- [ ] Contato com veículos (TechTudo, Canaltech, Jovem Nerd)
- [ ] Parcerias com 3-5 bares/locais em SP

#### Lançamento (mês 4)
- [ ] Press release oficial
- [ ] Cobertura em 10+ veículos
- [ ] Evento de lançamento em SP (festa + demo)
- [ ] 50 micro-influencers (10k-100k seguidores) por cidade
- [ ] TikTok challenge "seu primeiro match"
- [ ] Anúncios pagos (Meta + TikTok): R$ 30k/mês

#### Pós-lançamento (mês 5-6)
- [ ] Programa de embaixadores universitários (50 embaixadores)
- [ ] Eventos patrocinados em bares
- [ ] Conteúdo orgânico (3 posts/semana)
- [ ] Newsletter quinzenal
- [ ] Comunidade no Discord/Telegram

### Métricas de saída da Fase 3
| Métrica | Meta |
|---------|------|
| MAU | **50.000** |
| Downloads totais | **80.000** |
| DAU/MAU | **> 35%** |
| Conversão free → premium | **3%** |
| MRR | **R$ 45.000** |
| CAC | **< R$ 20** |
| NPS | **> 50** |
| Churn D30 | **< 12%** |

### Marcos importantes
- 🎯 10k downloads (mês 4)
- 🎯 25k MAU (mês 5)
- 🎯 50k MAU + R$ 45k MRR (mês 6)

---

## 🌎 Fase 4: Escala Nacional (Mês 7-12)

**Objetivo:** Expandir pra 12 capitais. Validar modelo B2B. Atingir 250k MAU e R$ 240k MRR.

### Expansão geográfica

| Mês | Cidades |
|-----|---------|
| 7 | Curitiba, Porto Alegre, Brasília |
| 8 | Vitória, Goiânia, Cuiabá |
| 9 | Manaus, Belém, Fortaleza, Natal |
| 10-12 | Cidades médias + refinamento |

### Entregas técnicas V2
- [ ] Stories locais (postar foto em hotspot por 24h)
- [ ] Integração com Spotify (música ouvida no local)
- [ ] Áudios longos no chat (até 3min)
- [ ] Reações em mensagens
- [ ] Temas visuais (Halloween, Carnaval, etc)
- [ ] Avatar customizado (borders, cores por selo)
- [ ] Multi-foto no perfil (carrossel)
- [ ] Compartilhar perfil via WhatsApp/Insta

### Receita B2B
- [ ] Painel de "Local Parceiro"
- [ ] Locais pagam por destaque no mapa
- [ ] Eventos oficiais com selo
- [ ] Insights anonimizados pra prefeituras

### Marketing de escala

#### Mês 7-9
- [ ] Aumento de budget pago: R$ 50k → R$ 100k/mês
- [ ] Anúncios em TV (campanha regional)
- [ ] Out-of-home (OOH) em capitais
- [ ] Patrocínio de eventos universitários

#### Mês 10-12
- [ ] Campanha nacional (R$ 200k)
- [ ] Influencers macro (100k+ seguidores)
- [ ] Parcerias com produtoras de show
- [ ] Lançamento do "Cruzei Premium Black"

### Features inovadoras
- [ ] **Cruzei Eventos** — eventos criados pelo app em locais
- [ ] **Cruzei Viagem** — match em outras cidades pra quem viaja
- [ ] **Cruzei Grupos** — comunidades por interesse (musculação, RPG, etc)
- [ ] **IA Match** — sugere baseado em hábitos similares

### Métricas de saída da Fase 4
| Métrica | Meta |
|---------|------|
| MAU | **250.000** |
| DAU/MAU | **> 38%** |
| Sessões/dia | **4+** |
| Conversão premium | **3-5%** |
| MRR | **R$ 240.000** |
| ARR | **R$ 2.880.000** |
| CAC | **< R$ 18** |
| LTV | **R$ 96+** |
| LTV/CAC | **> 5** |
| NPS | **> 55** |
| Cidades ativas | **12+** |

---

## 🛡️ Marcos de Risco e Plano B

### Marcos de risco que mudam o roadmap

#### Marco: Tração beta < 2k MAU no mês 3
**Diagnóstico:** Baixa aceitação do produto
**Plano B:**
- Entrevistas com 30 usuários beta (entender fricção)
- Pivotar features (ex: foco em amizade, não relacionamento)
- Considerar pivot pra outro vertical (turismo, eventos)
- Adiar lançamento público pra mês 6-7

#### Marco: Churn D30 > 25% no mês 6
**Diagnóstico:** Retenção baixa
**Plano B:**
- Programa agressivo de retenção (notificações personalizadas)
- Recompensas por check-in diário
- Gamificação mais profunda
- Parcerias com locais (descontos em bares)

#### Marco: CAC > R$ 50 no mês 6
**Diagnóstico:** Marketing pago não escala
**Plano B:**
- Pivot pra marketing orgânico (TikTok, conteúdo)
- Aumentar budget de micro-influencers
- Desenvolver referral program forte
- Crescer via eventos físicos

#### Marco: Problemas graves de LGPD
**Diagnóstico:** Vazamento, autuação
**Plano B:**
- Resposta imediata (< 24h)
- Auditoria completa de segurança
- Reforço de equipe jurídica
- Comunicação transparente com usuários

---

## 📊 Resumo Visual do Roadmap

```
Mês  1-2: ▓▓▓▓▓░░░░░░░░░░░░ MVP
Mês  3:   ░▓▓▓░░░░░░░░░░░░░ Beta fechado
Mês  4:   ░░▓▓▓▓░░░░░░░░░░░ Launch SP/RJ
Mês  5:   ░░░░▓▓▓░░░░░░░░░░ +BH/UDI
Mês  6:   ░░░░░▓▓▓░░░░░░░░░ +Floripa/Recife/Salvador
Mês  7-9: ░░░░░░▓▓▓▓▓░░░░░░ Expansão (Curitiba, POA, BSB, +4)
Mês 10-12:░░░░░░░░░░▓▓▓▓▓▓▓ Escala (12+ cidades, R$ 240k MRR)
```

---

## 🎬 Marcos de Comunicação

### Mês 1 — "Começamos"
- Post fundador anunciando projeto
- Newsletter inicial pra lista de espera

### Mês 3 — "Beta aberto"
- Press release de beta
- Demoday se aplicável

### Mês 4 — "Lançamento"
- Press release oficial
- Cobertura em veículos
- Evento físico

### Mês 6 — "Primeiros R$ 100k MRR"
- Blog post com aprendizados
- Case studies

### Mês 12 — "Nacional"
- Anúncio de expansão
- Press release de marcos

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [04-funcionalidades-free-premium.md](./04-funcionalidades-free-premium.md)
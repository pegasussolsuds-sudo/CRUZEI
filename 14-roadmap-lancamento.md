# 14 — Roadmap de Lançamento

> MVP → Beta → Launch → Escala.
> Cronograma, marcos, critérios de sucesso, equipe.

---

## 🎯 Visão Geral

Cruzei lança em **Uberlândia-MG** como beta privado, depois escala pra outras capitais, atinge Brasil inteiro em 12 meses.

### Cronograma macro

```
Mês 1-2:   MVP técnico (funcional, sem polimento)
Mês 3:     Beta privado em Uberlândia
Mês 4-5:   Lançamento público SP/RJ
Mês 6-8:   Expansão pra 5 capitais
Mês 9-12:  Escala nacional + monetização completa
Mês 13-18: B2B + features avançadas
```

---

## 📅 Marcos Detalhados

### 🔨 Marco 1: MVP (Mês 1-2)

**Objetivo:** App funcional com features core, pronto pra beta testers.

**Escopo:**

**Backend:**
- ✅ Auth (SMS code via Firebase)
- ✅ Cadastro de perfil
- ✅ Upload de fotos
- ✅ Localização em tempo real (background service)
- ✅ Mapa com avatares (geohash)
- ✅ Match com contexto geográfico
- ✅ Chat com expiração 48h
- ✅ Notificações push básicas
- ✅ Stripe / IAP setup (sem cobrar ainda)
- ✅ LGPD: delete account + export

**Mobile:**
- ✅ Onboarding (5 telas)
- ✅ Mapa Mapbox com tema Cruzei Day/Night
- ✅ Bottom sheet com pessoas próximas
- ✅ Perfil (próprio e de outros)
- ✅ Sistema de curtir/passar/super curtida
- ✅ Match screen com animação
- ✅ Chat com timer
- ✅ Configurações básicas
- ✅ Modo anônimo (toggle)

**Fora do escopo (vai pra V2):**
- Hotspots pulsantes
- Selos
- Premium+ features
- Verificação por selfie
- Templates de mensagem
- Filtros avançados
- Visitas
- Bloqueio (básico só)

**Equipe:**
- 1 Engenheiro Full-stack sênior (backend + mobile setup)
- 1 Engenheiro mobile (RN specialist)
- 1 Designer UI/UX
- 1 Product Manager (parcial)

**Critério de sucesso:**
- Build verde em iOS + Android
- 5 contas de teste funcionam end-to-end
- 1 match + 1 chat com timer expirando
- Push notification funciona
- Background location persiste por 1 hora com app fechado

---

### 🧪 Marco 2: Beta Privado (Mês 3)

**Objetivo:** 500-1.000 usuários reais em Uberlândia testando.

**Escopo adicional:**

**Backend:**
- ✅ Hotspots com pulse
- ✅ Sistema de denúncias (básico)
- ✅ Bloqueio de usuários
- ✅ Validação de receipts iOS/Android
- ✅ Subscription básica (Free + Premium)
- ✅ Boost (sem UI complexa ainda)

**Mobile:**
- ✅ Hotspots visuais
- ✅ Selos básicos (Cafeteria, Praieiro, Roadie)
- ✅ Filtros (distância, idade)
- ✅ Paywall screens
- ✅ Verificação por selfie (opcional)
- ✅ Boost UI

**Marketing pré-launch:**
- Landing page (cruzei.com.br)
- Waitlist com email
- Instagram e TikTok (@cruzei.app)
- Parceria com 2-3 bares locais
- Grupo de WhatsApp com beta testers

**Aquisição:**
- Instagram ads: R$ 5.000
- TikTok ads: R$ 3.000
- Marketing de guerrilha: R$ 2.000
- Influenciadores locais: R$ 5.000
- **Total: R$ 15.000**

**Equipe:**
- + 1 Engenheiro backend (foco em escala)
- + 1 Growth/Marketing

**Critérios de sucesso:**
- 500+ installs
- 60%+ completam onboarding (D1)
- 40%+ D7 retention
- 15%+ match rate
- 5+ matches por usuário (D7)
- NPS > 40
- 0 crashes críticos

**Decisão Go/No-Go:**
- ✅ Continuar se: NPS > 40, D7 > 40%, match rate > 15%
- ⚠️ Pivotar se: NPS < 30, D7 < 25%
- ❌ Matar se: NPS < 20, D7 < 15%

---

### 🚀 Marco 3: Lançamento Público (Mês 4-5)

**Objetivo:** 10.000+ MAU, premium ativado, primeiras receitas.

**Cidades:** Uberlândia + Ribeirão Preto + São José do Rio Preto (interior forte)

**Escopo adicional:**

**Backend:**
- ✅ Filtros avançados (orientação, idade, distância)
- ✅ Premium+ com avatar destacado
- ✅ Boost com pagamento
- ✅ Verificação automática (ML)
- ✅ Painel admin (básico)
- ✅ Moderação de fotos (Rekognition)
- ✅ Anônimo ilimitado (Premium+)

**Mobile:**
- ✅ Premium+ com glow no avatar
- ✅ Ver quem curtiu (Premium+)
- ✅ Filtros UI
- ✅ Boost flow
- ✅ Story onboarding (1x por semana)
- ✅ Push contextual (hotspots)

**Marketing:**
- Lançamento em São Paulo (evento de lançamento)
- Press release: "Tinder que mostra quem você realmente cruzou"
- TechCrunch, Pequenas Empresas & Grandes Negócios
- Podcast appearances
- TikTok: 1 vídeo por dia (orgânico)
- Instagram: 2 posts + stories diários
- Google Ads: R$ 10.000
- Meta Ads: R$ 15.000
- **Total: R$ 50.000**

**Equipe:**
- + 1 Designer (full-time)
- + 1 Engenheiro mobile
- + 1 Customer Support
- + 1 Moderador (parcial)

**Critérios de sucesso:**
- 10.000+ MAU
- 3%+ conversão Free → Premium
- R$ 10k+ MRR
- D7 retention > 35%
- D30 retention > 20%
- Crash-free rate > 99.5%

---

### 🌎 Marco 4: Expansão Nacional (Mês 6-8)

**Objetivo:** 50.000+ MAU em 5 capitais, R$ 50k MRR.

**Cidades:** SP, RJ, BH, Curitiba, Salvador

**Escopo adicional:**

**Backend:**
- ✅ Hotspots anônimos no mapa
- ✅ Stories de local (foto 24h em POI)
- ✅ Integração Spotify (mostrar o que ouviu no local)
- ✅ Programa de embaixadores universitários
- ✅ Painel admin completo
- ✅ Sistema de selos premium (pagos)
- ✅ Chat templates baseado em contexto
- ✅ Áudio messages

**Mobile:**
- ✅ Stories (estilo Instagram)
- ✅ Spotify integration
- ✅ Embaixadores UI
- ✅ Selos premium
- ✅ Áudio recorder

**Marketing:**
- Embaixadores em 10 universidades (R$ 1k cada = R$ 10k)
- Eventos em bares (R$ 50k)
- Festivais: 1 patrocínio (Lollapalooza? futuro)
- Micro-influencers (50 perfis × R$ 500 = R$ 25k)
- TV digital / OOH em SP (R$ 100k)
- **Total: R$ 250.000**

**Equipe:**
- + 1 Engenheiro DevOps
- + 1 Engenheiro backend
- + 2 Moderadores
- + 1 Data analyst

**Critérios de sucesso:**
- 50.000+ MAU
- R$ 50k+ MRR
- 5 capitais ativas (> 5k MAU cada)
- LTV/CAC > 3
- D30 churn < 15%
- NPS > 50

---

### 💼 Marco 5: Escala + B2B (Mês 9-12)

**Objetivo:** 250.000+ MAU, R$ 200k MRR, primeiros clientes B2B.

**Escopo adicional:**

**Backend:**
- ✅ Locais patrocinados (B2B)
- ✅ API de presença (B2B)
- ✅ Eventos parceiros (geofence)
- ✅ AI match scoring (V2)
- ✅ Stories locais (24h)
- ✅ Match com IA (sugestões personalizadas)
- ✅ Premium anual com desconto

**Mobile:**
- ✅ Locais patrocinados (pin destacado)
- ✅ Sugestões IA
- ✅ UI para eventos parceiros
- ✅ Compartilhar no Stories Instagram

**Marketing:**
- Lançar em todas as 27 capitais
- Festivais: 5 patrocínios
- Campanha nacional (R$ 500k)
- Equipe de vendas B2B (2 pessoas)
- **Total: R$ 1.000.000**

**Equipe:**
- + 3 Engenheiros
- + 1 AI/ML Engineer
- + 2 Vendas B2B
- + 1 Marketing Manager
- + 1 Designer (full)
- **Total: 15-18 pessoas**

**Critérios de sucesso:**
- 250.000+ MAU
- R$ 200k+ MRR
- 5+ clientes B2B ativos
- 3%+ conversão premium
- LTV > R$ 100
- LTV/CAC > 4

---

### 🌟 Marco 6: Internacionalização (Mês 13-18)

**Objetivo:** Expandir pra Portugal e Argentina.

**Escopo:**
- i18n (pt-BR, pt-PT, es-AR)
- Multi-currency
- Multi-region AWS
- Marketing local (Lisboa, Buenos Aires)
- Time de customer support bilíngue

---

## 💰 Investimento Total (12 meses)

| Categoria | Valor |
|-----------|-------|
| Equipe (salários + encargos) | R$ 1.200.000 |
| Infraestrutura | R$ 50.000 |
| Marketing | R$ 1.300.000 |
| Ferramentas (SaaS) | R$ 30.000 |
| Jurídico/LGPD | R$ 30.000 |
| Mobile dev accounts | R$ 5.000 |
| Impostos | R$ 100.000 |
| Contingência (10%) | R$ 271.000 |
| **TOTAL** | **R$ 2.986.000** |

### Fontes possíveis
- Founder's equity (R$ 500k)
- Friends & Family (R$ 500k)
- Pré-seed rodada (R$ 2M @ R$ 8M valuation)
- Receita (a partir do mês 4)

---

## 📊 KPIs por Marco

| Marco | MAU | D7 | Conversion | MRR |
|-------|-----|----|-----------|-----|
| MVP | 50 | - | - | - |
| Beta | 1.000 | 40% | - | - |
| Launch | 10.000 | 35% | 3% | R$ 10k |
| Expansão | 50.000 | 30% | 3% | R$ 50k |
| Escala | 250.000 | 25% | 3% | R$ 200k |
| Internacional | 500.000 | 22% | 3% | R$ 500k |

---

## ⚠️ Riscos por Marco

### MVP
- **Risco:** Não consegue fazer background location funcionar
- **Mitigação:** Fallback pra geofencing (opção B)

### Beta
- **Risco:** Baixo engajamento
- **Mitigação:** Gamificar com selos, eventos locais

### Launch
- **Risco:** Custo de aquisição alto (CAC)
- **Mitigação:** Foco em orgânico (TikTok), referral program

### Expansão
- **Risco:** Densidade baixa em cidades novas
- **Mitigação:** Lançar com marketing pesado em cada cidade

### Escala
- **Risco:** Concorrência copia feature
- **Mitigação:** Velocidade de execução, dados próprios como moat

---

## 🎯 Marcos de Decisão

### Após Beta (mês 3)
**Decidir:** Continuar, pivotar ou matar.
**Baseado em:** NPS, D7, match rate, feedback qualitativo.

### Após Launch (mês 5)
**Decidir:** Acelerar com mais capital ou crescer orgânico.
**Baseado em:** LTV/CAC, traction, feedback.

### Após Expansão (mês 8)
**Decidir:** Rodada Series A ou continuar bootstrap.
**Baseado em:** MRR, growth rate, métricas de produto.

---

## 📋 Checklist Pré-Launch (MVP)

### Legal
- [ ] CNPJ aberto
- [ ] Termo de uso
- [ ] Política de privacidade (LGPD)
- [ ] DPO designado
- [ ] Contratos com beta testers (NDA)

### Técnico
- [ ] Backend em produção (AWS/GCP)
- [ ] CI/CD pipeline
- [ ] Monitoring (Sentry)
- [ ] Analytics (Mixpanel/Amplitude)
- [ ] Error tracking
- [ ] Backup automático

### Produto
- [ ] App Store Connect (iOS)
- [ ] Play Console (Android)
- [ ] Privacy labels preenchidos
- [ ] Screenshots pra App Store
- [ ] Descrição PT-BR + EN
- [ ] TestFlight + Internal Track

### Marketing
- [ ] Landing page
- [ ] Instagram @cruzei.app
- [ ] TikTok @cruzei
- [ ] Logo + identidade visual
- [ ] Press kit
- [ ] Email de suporte

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [15-wireframes.md](./15-wireframes.md)
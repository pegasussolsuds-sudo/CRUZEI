# 20 — Checklist Final

> Tudo que precisa estar pronto antes de cada marco.
> Copie e use como template operacional.

---

## ✅ MVP (Mês 1-2)

### Backend

- [ ] Setup monorepo (pnpm + Turborepo)
- [ ] NestJS configurado
- [ ] PostgreSQL + PostGIS configurados
- [ ] Redis configurado
- [ ] Schema do banco migrado
- [ ] Bull queues (notifications, expiration, cleanup)
- [ ] Auth (SMS via Firebase + Apple/Google)
- [ ] JWT + refresh token
- [ ] Endpoints `/auth/*`
- [ ] Endpoints `/me/*` (perfil)
- [ ] Endpoints `/location/*` (update + nearby)
- [ ] Endpoints `/likes/*` + match logic
- [ ] Endpoints `/matches/*` + chat com expiração
- [ ] Endpoints `/notifications/*`
- [ ] WebSocket gateway pro chat
- [ ] WebSocket gateway pra presence
- [ ] LGPD: delete account + export
- [ ] Audit log
- [ ] Rate limiting
- [ ] CORS configurado
- [ ] Health check `/health`
- [ ] Logs estruturados (pino)
- [ ] Error tracking (Sentry)
- [ ] Backup automático
- [ ] CI/CD (GitHub Actions)
- [ ] Deploy em produção (AWS/GCP)

### Mobile (React Native)

- [ ] Setup RN + TS + ESLint + Prettier
- [ ] Navegação (React Navigation)
- [ ] Telas de onboarding (5 telas)
- [ ] Tela de mapa (Mapbox)
- [ ] Bottom sheet com pessoas próximas
- [ ] Tela de perfil próprio
- [ ] Tela de perfil de outro
- [ ] Tela de match com animação
- [ ] Tela de chat
- [ ] Tela de configurações
- [ ] Modo anônimo (toggle)
- [ ] Sistema de curtir/passar/super curtida
- [ ] Background location
- [ ] Push notifications (FCM)
- [ ] Permissions flow
- [ ] Auth state persistente
- [ ] API client + interceptors
- [ ] WebSocket client
- [ ] Estado global (Zustand)
- [ ] Tema (cores, typography, spacing)
- [ ] Componentes base (Avatar, Button, Card, Chip)
- [ ] Storybook (futuro)
- [ ] Error boundary
- [ ] Crash reporting (Sentry)

### Design

- [ ] Logo + identidade visual
- [ ] Paleta de cores definida
- [ ] Tipografia escolhida
- [ ] Estilo Mapbox Day criado
- [ ] Estilo Mapbox Night criado
- [ ] Wireframes de todas as telas
- [ ] Mockups de alta fidelidade (Figma)
- [ ] Ícones customizados (POIs, selos)
- [ ] Animações definidas
- [ ] Splash screen + app icon

### Legal

- [ ] CNPJ aberto (MEI ou LTDA)
- [ ] Termo de uso
- [ ] Política de privacidade (LGPD)
- [ ] DPO designado
- [ ] Privacy labels preenchidos (App Store + Play)

### Marketing

- [ ] Landing page (cruzei.com.br)
- [ ] Instagram @cruzei.app criado
- [ ] TikTok @cruzei criado
- [ ] Logo + branding assets
- [ ] Press kit
- [ ] Email de suporte

### App Store

- [ ] Apple Developer Account ($99/ano)
- [ ] Google Play Console ($25 uma vez)
- [ ] App Store Connect configurado
- [ ] Build iOS enviada pra TestFlight
- [ ] Build Android enviada pra Internal Track
- [ ] Descrição PT-BR + EN
- [ ] Screenshots pra store
- [ ] Metadata + keywords
- [ ] Privacy nutrition labels

---

## 🧪 Beta Privado (Mês 3)

### Features adicionais

- [ ] Hotspots com pulse no mapa
- [ ] Selos básicos (Cafeteria, Praieiro, Roadie)
- [ ] Filtros (distância, idade)
- [ ] Paywall screens (Free → Premium)
- [ ] Verificação por selfie
- [ ] Boost UI
- [ ] Stripe/IAP pra pagamentos
- [ ] Bloqueio + Denúncia

### Operacional

- [ ] Waitlist ativa no site
- [ ] Grupo WhatsApp com beta testers
- [ ] Planilha de feedback
- [ ] Bug tracking (Linear / Jira)
- [ ] Customer support (email + in-app)
- [ ] Moderação humana (1 pessoa)

### Métricas

- [ ] Mixpanel configurado
- [ ] Amplitude configurado
- [ ] Dashboards prontos (DAU, MAU, retention)
- [ ] Funil de onboarding medido
- [ ] NPS survey implementado

### Marketing pré-launch

- [ ] 2-3 parcerias com bares em Uberlândia
- [ ] Instagram ads (R$ 5k)
- [ ] TikTok ads (R$ 3k)
- [ ] Micro-influenciadores locais (R$ 5k)
- [ ] Marketing de guerrilha (R$ 2k)
- [ ] Landing page → signup conversion tracking

---

## 🚀 Lançamento Público (Mês 4-5)

### Features adicionais

- [ ] Premium+ com glow no avatar
- [ ] Ver quem curtiu (Premium+)
- [ ] Filtros avançados (orientação, idade, distância)
- [ ] Boost flow completo
- [ ] Story onboarding (1x/semana)
- [ ] Push contextual (hotspots, novo match)
- [ ] Painel admin (básico)
- [ ] Moderação automática de fotos
- [ ] Anônimo ilimitado (Premium+)

### Operacional

- [ ] Customer support 24/7 (chat)
- [ ] 2 moderadores full-time
- [ ] Sistema de tickets
- [ ] SLA definido (8h denúncia, 24h suporte)

### Marketing

- [ ] Evento de lançamento em SP
- [ ] Press release (TechCrunch, INFO Online)
- [ ] Podcast appearances (5 podcasts)
- [ ] TikTok orgânico (1 vídeo/dia)
- [ ] Instagram orgânico (2 posts + stories/dia)
- [ ] Google Ads (R$ 10k)
- [ ] Meta Ads (R$ 15k)
- [ ] Email marketing (waitlist → ativo)

### Legal

- [ ] Contrato de parceria com bares
- [ ] Compliance IAPS (Apple + Google)
- [ ] Atualização de Privacy Policy

---

## 🌎 Expansão Nacional (Mês 6-8)

### Features adicionais

- [ ] Stories locais (24h em POI)
- [ ] Integração Spotify
- [ ] Programa de embaixadores
- [ ] Painel admin completo
- [ ] Selos premium (pagos)
- [ ] Chat templates baseados em contexto
- [ ] Áudio messages

### Operacional

- [ ] 1 DevOps engineer
- [ ] 1 Backend engineer
- [ ] 2 Moderadores
- [ ] 1 Data analyst

### Marketing

- [ ] Embaixadores em 10 universidades (R$ 1k cada)
- [ ] Eventos em bares (R$ 50k)
- [ ] Festivais (1 patrocínio)
- [ ] Micro-influenciadores (50 perfis × R$ 500)
- [ ] TV digital / OOH em SP (R$ 100k)

### Infraestrutura

- [ ] Multi-region deployment
- [ ] CDN configurado (Cloudflare)
- [ ] Disaster recovery
- [ ] Load testing
- [ ] Security audit

---

## 💼 Escala + B2B (Mês 9-12)

### Features adicionais

- [ ] Locais patrocinados (B2B)
- [ ] API de presença (B2B)
- [ ] Eventos parceiros
- [ ] AI match scoring
- [ ] Match com IA (sugestões personalizadas)
- [ ] Premium anual com desconto
- [ ] Compartilhar Stories no Instagram

### Operacional

- [ ] 3 Engenheiros adicionais
- [ ] 1 AI/ML engineer
- [ ] 2 Vendas B2B
- [ ] 1 Marketing Manager
- [ ] 1 Designer (full)
- [ ] **Total: 15-18 pessoas**

### Marketing

- [ ] Lançamento em 27 capitais
- [ ] 5 patrocínios de festivais
- [ ] Campanha nacional (R$ 500k)
- [ ] Sales team B2B (2 pessoas)
- [ ] Materiais B2B (deck, one-pager)

### Infraestrutura

- [ ] Multi-region (SP, RJ, BH)
- [ ] Auto-scaling Kubernetes
- [ ] Data lakehouse pra BI
- [ ] ML platform (SageMaker / Vertex)

---

## 🌟 Internacionalização (Mês 13-18)

### Features

- [ ] i18n (pt-BR, pt-PT, es-AR)
- [ ] Multi-currency (BRL, EUR, ARS)
- [ ] Stripe Atlas pra US entity
- [ ] Customer support bilíngue

### Operacional

- [ ] Marketing local (Lisboa, Buenos Aires)
- [ ] Equipe bilingue
- [ ] Compliance GDPR (EU)

---

## 📋 Templates de Checklist por Tarefa

### Adicionar Nova Feature

```
□ PRD/SPEC da feature
□ Modelo de dados (se novo)
□ Schema do banco (migration)
□ API endpoints
□ WebSocket events (se real-time)
□ Mobile: telas + componentes
□ Mobile: stores + services
□ Tests (unit + integration)
□ Analytics events
□ Feature flag (se gradual rollout)
□ Documentação atualizada
□ QA manual
□ Deploy em staging → produção
□ Métricas definidas
□ Suporte preparado
```

### Adicionar Novo POI Category

```
□ Categoria no enum (DB + mobile)
□ Ícone custom (SVG)
□ Mapa: estilo pra essa categoria
□ OSM/Google: tags correspondentes
□ Importer script
□ API filter support
□ Mobile: filtro UI
□ Mobile: ícone no mapa
□ Tests
```

### Resolver Bug Crítico

```
□ Reproduzir em staging
□ Identificar root cause
□ Fix + testes
□ Code review
□ Deploy em produção
□ Monitoring por 24h
□ Postmortem (se relevante)
□ Comunicar se afetou usuários
```

### Deploy em Produção

```
□ CI verde
□ Tests passando
□ Staging testado manualmente
□ DB migrations testadas
□ Feature flags configurados
□ Deploy gradual (canary)
□ Monitoring (Sentry, Datadog)
□ Rollback plan pronto
□ Time avisado
□ Métricas baseline
```

---

## 🎯 Definition of Done

Uma feature só é "pronta" quando:

```
[ ] Código escrito + revisado
[ ] Tests unitários (coverage > 80%)
[ ] Tests de integração passando
[ ] Mobile funciona em iOS + Android
[ ] Sem regressão nas features existentes
[ ] Analytics events implementados
[ ] Documentação atualizada
[ ] QA manual validou
[ ] Feature flag (se aplicável)
[ ] Deploy em produção
[ ] Métricas monitoradas por 7 dias
[ ] Customer support informado
[ ] Bug zero por 48h
```

---

## 📊 Status Atual do Projeto

Use este template pra reportar status:

```markdown
## Status — [Data]

**Marco atual:** [MVP / Beta / Launch / Escala]

**Completude:**
- Backend: [XX]%
- Mobile: [XX]%
- Design: [XX]%
- Marketing: [XX]%
- Legal: [XX]%

**Bloqueios:**
1. [bloqueio crítico 1]
2. [bloqueio crítico 2]

**Próximas ações:**
1. [ação 1 - responsável - prazo]
2. [ação 2 - responsável - prazo]

**Métricas-chave:**
- DAU: [X]
- MAU: [X]
- Conversão: [X]%
- MRR: R$ [X]
- NPS: [X]
```

---

## 🚦 Decision Gates

Em cada marco, decidir:

| Marco | Decisão | Baseado em |
|-------|---------|------------|
| Após MVP | Continuar / Pivotar / Matar | Funciona tecnicamente, time tá comprometido |
| Após Beta | Continuar / Pivotar / Matar | NPS > 40, D7 > 40%, match rate > 15% |
| Após Launch | Acelerar / Orgânico | LTV/CAC > 3, traction |
| Após Expansão | Series A / Bootstrap | MRR, growth rate |

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [00-indice.md](./00-indice.md) ou começar a construir!
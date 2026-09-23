# 07 — Arquitetura Técnica

> Stack, módulos, decisões de arquitetura.
> O esqueleto que sustenta o Cruzei.

---

## 🎯 Filosofia

1. **Stack madura e battle-tested** — não reinventar a roda
2. **Tipagem em tudo** — TypeScript end-to-end
3. **Modular** — features isoladas, fácil de remover/trocar
4. **Performance** — mapas em tempo real exigem baixa latência
5. **LGPD-first** — privacidade desde a arquitetura, não como feature
6. **Escalável** — começar pequeno, escalar sem reescrever

---

## 📦 Stack

### Mobile (iOS + Android)

| Tecnologia | Versão | Justificativa |
|-----------|--------|---------------|
| **React Native** | 0.74+ | 1 codebase iOS+Android, ecossistema maduro |
| **TypeScript** | 5.x | Tipagem em tudo |
| **Expo** | 51+ | Tooling, builds, OTA updates (alternativa: bare RN) |
| **React Navigation** | 6.x | Roteamento |
| **Zustand** | 4.x | Estado global (mais simples que Redux) |
| **React Query (TanStack Query)** | 5.x | Cache + sincronização com backend |
| **Reanimated** | 3.x | Animações performáticas |
| **Mapbox GL** | 11.x | Mapa customizado estilo Pokémon GO |
| **Socket.io Client** | 4.x | Chat em tempo real |
| **AsyncStorage** | 2.x | Persistência local |
| **Notifee** | 9.x | Notificações locais avançadas |
| **React Native Gesture Handler** | 2.x | Gestos nativos |

**Decisão pendente:** Expo (managed) ou bare React Native?

| Expo | Bare RN |
|------|---------|
| ✅ Build mais rápido | ✅ Controle total |
| ✅ OTA updates grátis | ✅ Modules nativos sem eject |
| ✅ Expo Go pra testes | ✅ Bundle menor |
| ⚠️ Limitações em módulos nativos | ⚠️ Setup mais complexo |
| ⚠️ Mapbox requer config extra | ✅ Mapbox funciona direto |

**Recomendação:** Bare RN com Expo Modules (híbrido). Mapbox e Socket.io funcionam melhor.

### Backend

| Tecnologia | Versão | Justificativa |
|-----------|--------|---------------|
| **Node.js** | 20 LTS | Async, ecossistema |
| **NestJS** | 10.x | Estrutura sólida, TypeScript-first, DI |
| **TypeScript** | 5.x | Tipagem |
| **PostgreSQL** | 15+ | Relacional + JSONB + PostGIS |
| **Redis** | 7+ | Cache, presença, pub/sub |
| **Prisma** | 5.x | ORM type-safe (alternativa: TypeORM) |
| **Socket.io** | 4.x | WebSocket com rooms |
| **Bull** | 4.x | Filas (jobs agendados) |
| **JWT** | — | Auth tokens |
| **Stripe** | 14.x | Pagamentos |
| **AWS SDK** | 3.x | S3, SQS, etc |

### Infraestrutura

| Serviço | Uso | Custo estimado (mês 6) |
|---------|-----|------------------------|
| **AWS São Paulo** | Hosting backend | R$ 1.500 |
| **Cloudflare R2** | Storage de fotos | R$ 200 |
| **CloudFlare** | CDN + WAF | R$ 100 |
| **Mapbox** | Mapas (até 50k loads grátis) | R$ 500 |
| **Firebase** | FCM (push), Analytics | R$ 200 |
| **Sentry** | Error monitoring | R$ 100 |
| **Mixpanel + Amplitude** | Analytics | R$ 500 |
| **Total infra** | — | **~R$ 3.100/mês** |

### Ferramentas de Dev

| Ferramenta | Uso |
|-----------|-----|
| **pnpm** | Gerenciador de pacotes (monorepo) |
| **Turborepo** | Build system pro monorepo |
| **Docker** | Containers (Postgres, Redis local) |
| **GitHub Actions** | CI/CD |
| **ESLint + Prettier** | Linting |
| **Husky** | Pre-commit hooks |
| **Jest** | Testes unitários |
| **Playwright** | Testes E2E (futuro) |
| **Storybook** | Componentes (mobile) |

---

## 🏗️ Estrutura do Monorepo

```
cruzei/
├── apps/
│   ├── mobile/              # React Native app
│   │   ├── src/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   ├── theme/
│   │   │   ├── config/
│   │   │   └── App.tsx
│   │   ├── ios/
│   │   ├── android/
│   │   └── package.json
│   │
│   ├── backend/             # NestJS API
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── location/
│   │   │   │   ├── matches/
│   │   │   │   ├── messages/
│   │   │   │   ├── pois/
│   │   │   │   ├── subscriptions/
│   │   │   │   └── notifications/
│   │   │   ├── common/
│   │   │   │   ├── guards/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── pipes/
│   │   │   │   └── decorators/
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   │   ├── migrations/
│   │   │   │   └── seeds/
│   │   │   ├── redis/
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── admin/               # Painel admin (Next.js - futuro)
│
├── packages/
│   ├── shared-types/        # Tipos compartilhados (User, Match, etc)
│   ├── shared-utils/        # Funções utilitárias
│   ├── eslint-config/       # Config ESLint compartilhada
│   └── tsconfig/            # Config TS compartilhada
│
├── docker-compose.yml       # Postgres + Redis pra dev local
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Detalhes em [13-estrutura-pastas.md](./13-estrutura-pastas.md).

---

## 🔧 Módulos do Backend

### Estrutura NestJS padrão

```
src/modules/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/
│   │   ├── jwt.strategy.ts
│   │   └── firebase.strategy.ts
│   └── dto/
│       ├── login.dto.ts
│       └── register.dto.ts
│
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── users.repository.ts
│   └── dto/
│       ├── update-profile.dto.ts
│       └── update-settings.dto.ts
│
├── location/
│   ├── location.module.ts
│   ├── location.controller.ts
│   ├── location.service.ts
│   ├── location.gateway.ts          # WebSocket
│   └── services/
│       ├── geohash.service.ts        # Encoding/decoding
│       ├── presence.service.ts       # Redis presence
│       └── hotspot.service.ts        # Detecção de clusters
│
├── matches/
│   ├── matches.module.ts
│   ├── matches.controller.ts
│   ├── matches.service.ts
│   ├── likes.service.ts
│   └── gateways/
│       └── match.gateway.ts          # Notificação de match
│
├── messages/
│   ├── messages.module.ts
│   ├── messages.controller.ts
│   ├── messages.service.ts
│   ├── messages.gateway.ts          # Chat em tempo real
│   └── services/
│       └── expiration.service.ts    # Limpa mensagens expiradas
│
├── pois/
│   ├── pois.module.ts
│   ├── pois.controller.ts
│   ├── pois.service.ts
│   └── importers/
│       ├── osm-importer.service.ts    # OpenStreetMap
│       └── google-importer.service.ts # Google Places
│
├── subscriptions/
│   ├── subscriptions.module.ts
│   ├── subscriptions.controller.ts
│   ├── subscriptions.service.ts
│   ├── apple-iap.service.ts
│   ├── google-billing.service.ts
│   └── stripe.service.ts
│
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.service.ts
│   ├── fcm.service.ts                # Firebase
│   └── templates/
│       ├── match.template.ts
│       ├── message.template.ts
│       └── hotspot.template.ts
│
└── anonymous/
    ├── anonymous.module.ts
    ├── anonymous.controller.ts
    └── anonymous.service.ts
```

### Detalhes de módulos críticos

#### Auth Module
```typescript
// Auth flow
1. POST /auth/request-code → envia SMS via Firebase Auth
2. POST /auth/login → valida código, retorna JWT
3. JWT middleware em todas rotas (exceto públicas)
4. Token refresh em 401
```

#### Location Module
```typescript
// Fluxo de atualização
1. Mobile detecta mudança (15m + 5min)
2. POST /location/update com lat/lng
3. Backend:
   a. Valida com geofence
   b. Calcula geohash
   c. Salva em Redis (presença 5h)
   d. Persiste em Postgres (histórico)
   e. Verifica POI próximo
   f. Recalcula hotspots da cidade
4. Retorna: nearby users, hotspots, geohash

// WebSocket (presence)
Socket.IO room: `presence:{city}:{geohash_5}`
- join ao abrir mapa
- broadcast de avatares no raio
- leave ao fechar mapa
```

#### Match Module
```typescript
// Algoritmo de match
1. User A curte User B
2. Verifica se User B já curtiu User A
3. Se sim:
   a. Cria match
   b. Gera contexto ("vocês se cruzaram no X")
   c. Envia push pra ambos
   d. Chat expira em 48h
4. Se não:
   a. Salva like
   b. Notifica User B (se permitido)

// Notificação de match via WebSocket
Gateway: match.gateway.ts
Event: 'match:created'
Payload: { match_id, user, context, chat_expires_at }
```

#### Messages Module
```typescript
// WebSocket events
- chat:join (cliente entra na sala do match)
- chat:message (envia mensagem)
- chat:typing (está digitando)
- chat:read (leu mensagens)
- chat:expiring (alerta de expiração)

// Expiração
Cron job a cada 1h:
- Marca mensagens expiradas
- Marca matches expirados
- Notifica usuários 12h antes
```

---

## 🗺️ Fluxo de Dados (Mapa)

```
┌─────────────┐
│   MOBILE    │
└──────┬──────┘
       │ Background location (60s fg, 300s bg)
       ▼
┌─────────────────┐
│ POST /location  │
│     /update     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Backend (NestJS)                   │
│  ┌─────────────────────────────┐    │
│  │ 1. Valida JWT               │    │
│  │ 2. Verifica geofence        │    │
│  │ 3. Calcula geohash          │    │
│  └─────────┬───────────────────┘    │
│            ▼                        │
│  ┌─────────────────────────────┐    │
│  │ Redis (presença 5h)        │    │
│  │ - geohash:{g}:{user_id}    │    │
│  │ - user:loc:{user_id}       │    │
│  └─────────┬───────────────────┘    │
│            ▼                        │
│  ┌─────────────────────────────┐    │
│  │ Postgres (histórico)        │    │
│  │ - locations table           │    │
│  └─────────┬───────────────────┘    │
│            ▼                        │
│  ┌─────────────────────────────┐    │
│  │ Detecta POI próximo         │    │
│  └─────────┬───────────────────┘    │
│            ▼                        │
│  ┌─────────────────────────────┐    │
│  │ Recalcula hotspots          │    │
│  └─────────┬───────────────────┘    │
└────────────┼────────────────────────┘
             │
             ▼
┌────────────────────────────┐
│ Mobile recebe:             │
│ - nearby users             │
│ - nearby hotspots          │
│ - nearby POIs              │
│ - own geohash              │
└────────────────────────────┘
```

---

## 🔌 Integrações Externas

### Firebase Authentication
- SMS code (Brasil: 1000 grátis/dia, depois $0.06/SMS)
- Backup: Twilio se Firebase tiver problema

### Mapbox
- Estilo custom "Cruzei Day" e "Cruzei Night"
- Telemetria desabilitada (privacidade)
- Static API pra imagens de mapa (futuro)

### Stripe / Apple IAP / Google Billing
- iOS: obrigatório usar IAP
- Android: Billing client
- Web (futuro): Stripe Checkout

### Firebase Cloud Messaging (FCM)
- Push iOS + Android unificado
- Tópicos por cidade (`hotspot:uberlandia`)

### Cloudflare R2
- Upload de fotos (presigned URLs)
- Sem custo de egress
- Criptografia at-rest

---

## 🔐 Segurança

### Autenticação
- JWT com refresh token
- Access token: 15min
- Refresh token: 30 dias
- Token em cookie httpOnly (web) ou AsyncStorage (mobile)

### Rate limiting
```typescript
// ThrottlerModule no NestJS
@Throttle({ default: { limit: 100, ttl: 60000 } })  // 100 req/min padrão

// Endpoints sensíveis têm limites menores
@Throttle({ default: { limit: 5, ttl: 60000 } })  // login: 5/min
```

### Validação de input
- class-validator em todos DTOs
- Sanitização de strings (XSS prevention)
- Validação de geolocalização (raio válido)

### Criptografia
- HTTPS em todas conexões
- TLS 1.3
- DB encryption at-rest (RDS)
- Backup encryption (S3)

### LGPD
- Opt-in explícito
- Direito ao esquecimento (delete account)
- Export de dados pessoais
- Log de consentimento

---

## 📊 Performance

### Mobile
- Lista de pessoas: virtualizada (FlatList + windowSize)
- Imagens: lazy load + cache (FastImage)
- Mapa: clustering nativo Mapbox
- Estado: Zustand (mais leve que Redux)

### Backend
- Cache agressivo (Redis)
- Query optimization (índices no Postgres)
- CDN pra assets estáticos
- Compression (gzip/brotli)

### Banco
- Índices geográficos (GIST no PostGIS)
- Particionamento de locations por mês
- Connection pooling (PgBouncer)

---

## 🧪 Testes

### Unitários (Jest)
- Coverage mínimo: 70%
- Foco em services e regras de negócio

### Integração
- Testes com Postgres + Redis reais (docker-compose)
- Testes de API (supertest)

### E2E (futuro)
- Playwright pra web
- Detox pra mobile (se sobrar budget)

### Snapshot
- Storybook + snapshot testing pra componentes

---

## 🚀 Deploy

### Ambientes

| Ambiente | URL | Deploy |
|----------|-----|--------|
| **Dev local** | localhost | `pnpm dev` |
| **Staging** | staging.cruzei.com | Auto via GitHub Actions (branch main) |
| **Prod** | api.cruzei.com | Manual approval |

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/backend.yml
name: Backend CI

on:
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:15
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm --filter backend test
      - run: pnpm --filter backend lint
      - run: pnpm --filter backend typecheck

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v3
      - run: aws s3 sync ./backend/dist s3://cruzei-backend-staging
      - run: aws ecs update-service --service cruzei-backend-stg
```

### Mobile
- EAS Build (Expo) ou Fastlane (bare RN)
- TestFlight (iOS) + Play Console Internal Track (Android)
- OTA updates via Expo pra fixes de JS

---

## 📈 Monitoramento

### Sentry (errors)
- Backend: NestJS
- Mobile: React Native
- Performance monitoring

### Mixpanel + Amplitude (analytics)
- Funis de onboarding
- Eventos custom: match, message, hotspot
- Cohort retention

### Logs (Datadog ou CloudWatch)
- Estruturados (JSON)
- Correlação por user_id

---

## 🛡️ Compliance

### LGPD
- DPO designado (mesmo que fundador)
- Política de privacidade pública
- Termos de uso com aceite explícito
- Direito de export/delete implementado

### Apple App Store
- Privacy labels atualizados
- Sign in with Apple (oferecer como alternativa)
- IAP obrigatório (já cumprido)

### Google Play
- Data safety form preenchido
- Target API 34+ (Android 14)
- Billing compliance

---

## 📅 Decisões Técnicas por Marco

| Marco | Decisão | Justificativa |
|-------|---------|---------------|
| M1 | Bare RN (não Expo) | Mapbox + Socket.io funcionam melhor |
| M1 | NestJS | Estrutura sólida, escala bem |
| M1 | PostgreSQL + PostGIS | Geolocalização nativa |
| M1 | Redis 7 | Presença, pub/sub |
| M2 | Background location | Precisão alta (opção A escolhida) |
| M3 | Prisma | Type-safe, migrations fáceis |
| M4 | Bull pra filas | Jobs de limpeza/expiração |
| M5 | Stripe + IAP | Receita flexível |

---

## 🔮 Futuro (V2+)

### Quando crescer
- **Microserviços** —拆分 (matches, chat, location) quando bater 100k MAU
- **Elasticsearch** — busca de usuários/POIs
- **CDN de mapas próprio** — Mapbox self-host se custo subir
- **AI/ML** — match scoring, moderação de fotos
- **Realtime geofencing** — substituir geohash por PostGIS ST_Distance

### Quando expandir internacional
- i18n (i18next)
- Multi-currency
- Multi-region AWS
- LGPD-equivalent por país (GDPR, CCPA)

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [08-schema-banco-dados.md](./08-schema-banco-dados.md)
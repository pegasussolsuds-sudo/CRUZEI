# 13 — Estrutura de Pastas

> Organização de código: monorepo, apps, packages.
> Padrão de pastas pra escalar sem virar bagunça.

---

## 📦 Monorepo com pnpm + Turborepo

### Por que monorepo?

- Compartilhar tipos entre mobile e backend (TypeScript)
- Reutilizar ESLint/Prettier configs
- Builds coordenadas via Turborepo
- CI mais simples (1 repo, várias apps)
- Refatoração cross-app facilitada

### Por que pnpm?

- Mais rápido que npm/yarn
- Symlinks nativos (workspace eficiente)
- Strict mode (evita dependencies fantasmas)
- Disk space saving (content-addressable store)

---

## 📁 Estrutura Raiz

```
cruzei/
├── apps/
│   ├── mobile/                    # React Native (iOS + Android)
│   ├── backend/                   # NestJS API
│   └── admin/                     # Painel admin (Next.js, futuro)
│
├── packages/
│   ├── shared-types/              # Tipos compartilhados (User, Match, etc)
│   ├── shared-utils/              # Funções utilitárias
│   ├── eslint-config/             # Config ESLint
│   ├── tsconfig/                  # Config TypeScript
│   └── ui-mobile/                 # Design system mobile (Storybook)
│
├── tools/
│   ├── scripts/                   # Scripts utilitários
│   └── migrations/                # SQL migrations
│
├── .github/
│   ├── workflows/                 # GitHub Actions
│   └── CODEOWNERS
│
├── .vscode/
│   ├── settings.json
│   └── extensions.json
│
├── docker-compose.yml             # Postgres + Redis local
├── turbo.json                     # Turborepo config
├── pnpm-workspace.yaml
├── package.json
├── .editorconfig
├── .gitignore
├── .prettierrc
├── .nvmrc                         # Node version
└── README.md
```

---

## 📱 apps/mobile/

```
apps/mobile/
├── src/
│   ├── App.tsx
│   ├── app.config.ts              # Expo config (se Expo)
│   │
│   ├── screens/                   # Telas
│   │   ├── Onboarding/
│   │   │   ├── SplashScreen.tsx
│   │   │   ├── LoginScreen.tsx
│   │   │   ├── PhoneInputScreen.tsx
│   │   │   ├── CodeVerificationScreen.tsx
│   │   │   ├── PermissionsScreen.tsx
│   │   │   ├── ProfileSetupScreen.tsx
│   │   │   ├── PhotosUploadScreen.tsx
│   │   │   ├── InterestsScreen.tsx
│   │   │   └── AnonymityChoiceScreen.tsx
│   │   │
│   │   ├── Map/
│   │   │   ├── MapScreen.tsx          # Tela principal
│   │   │   ├── MapLayers.tsx          # Avatares, hotspots, POIs
│   │   │   ├── BottomSheet.tsx
│   │   │   └── AvatarMarker.tsx
│   │   │
│   │   ├── Profile/
│   │   │   ├── ProfileScreen.tsx      # Meu perfil
│   │   │   ├── OtherProfileScreen.tsx
│   │   │   ├── EditProfileScreen.tsx
│   │   │   ├── PhotosScreen.tsx
│   │   │   ├── VerificationScreen.tsx
│   │   │   ├── SettingsScreen.tsx
│   │   │   └── PremiumScreen.tsx
│   │   │
│   │   ├── Match/
│   │   │   ├── MatchScreen.tsx        # Confirmação de match
│   │   │   ├── MatchListScreen.tsx
│   │   │   └── ChatScreen.tsx
│   │   │
│   │   ├── Paywall/
│   │   │   ├── PaywallScreen.tsx
│   │   │   └── BoostScreen.tsx
│   │   │
│   │   └── Misc/
│   │       ├── NotificationsScreen.tsx
│   │       ├── BlockedUsersScreen.tsx
│   │       ├── PrivacyPolicyScreen.tsx
│   │       └── TermsScreen.tsx
│   │
│   ├── components/                # Componentes reutilizáveis
│   │   ├── Avatar/
│   │   ├── Button/
│   │   ├── Card/
│   │   ├── Chip/
│   │   ├── Input/
│   │   ├── Modal/
│   │   ├── Photo/
│   │   ├── Seal/
│   │   ├── Switch/
│   │   └── Timer/
│   │
│   ├── navigation/                # Rotas
│   │   ├── AppNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   ├── MainNavigator.tsx       # Tabs
│   │   └── linking.ts              # Deep links
│   │
│   ├── stores/                    # Estado global (Zustand)
│   │   ├── authStore.ts
│   │   ├── userStore.ts
│   │   ├── matchesStore.ts
│   │   ├── messagesStore.ts
│   │   └── settingsStore.ts
│   │
│   ├── services/                  # Lógica de negócio
│   │   ├── api.ts
│   │   ├── socket.ts
│   │   ├── location.ts
│   │   ├── notifications.ts
│   │   ├── permissions.ts
│   │   ├── analytics.ts
│   │   ├── crashlytics.ts
│   │   ├── payments.ts
│   │   └── storage.ts
│   │
│   ├── hooks/                     # Custom hooks
│   │   ├── useAuth.ts
│   │   ├── useLocation.ts
│   │   ├── useMatches.ts
│   │   ├── useMessages.ts
│   │   └── useSocket.ts
│   │
│   ├── theme/                     # Design system
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   ├── spacing.ts
│   │   ├── shadows.ts
│   │   └── index.ts
│   │
│   ├── config/
│   │   ├── constants.ts
│   │   ├── env.ts                  # Variáveis de ambiente
│   │   └── location.ts
│   │
│   ├── types/                     # Tipos locais
│   │   └── react-navigation.d.ts
│   │
│   └── utils/                     # Funções auxiliares
│       ├── date.ts
│       ├── geo.ts                  # Geohash helpers
│       ├── validation.ts
│       └── format.ts
│
├── ios/
│   ├── Cruzei/
│   ├── Cruzei.xcodeproj
│   ├── CruzeiTests/
│   └── Podfile
│
├── android/
│   ├── app/
│   ├── gradle/
│   └── settings.gradle
│
├── __tests__/                     # Testes unitários
├── e2e/                           # Testes E2E (Detox, futuro)
├── .detoxrc.json
├── babel.config.js
├── metro.config.js
├── react-native.config.js
├── tsconfig.json
├── package.json
└── README.md
```

---

## 🖥️ apps/backend/

```
apps/backend/
├── src/
│   ├── main.ts                     # Bootstrap
│   ├── app.module.ts
│   │
│   ├── modules/                    # Features
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   ├── firebase.strategy.ts
│   │   │   │   └── apple.strategy.ts
│   │   │   └── dto/
│   │   │       ├── login.dto.ts
│   │   │       └── register.dto.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   └── dto/
│   │   │
│   │   ├── location/
│   │   │   ├── location.module.ts
│   │   │   ├── location.controller.ts
│   │   │   ├── location.service.ts
│   │   │   ├── location.gateway.ts          # WebSocket
│   │   │   └── services/
│   │   │       ├── geohash.service.ts
│   │   │       ├── presence.service.ts      # Redis
│   │   │       └── hotspot.service.ts
│   │   │
│   │   ├── matches/
│   │   │   ├── matches.module.ts
│   │   │   ├── matches.controller.ts
│   │   │   ├── matches.service.ts
│   │   │   ├── likes.service.ts
│   │   │   └── gateways/
│   │   │       └── match.gateway.ts
│   │   │
│   │   ├── messages/
│   │   │   ├── messages.module.ts
│   │   │   ├── messages.controller.ts
│   │   │   ├── messages.service.ts
│   │   │   ├── messages.gateway.ts          # WebSocket chat
│   │   │   └── services/
│   │   │       └── expiration.service.ts
│   │   │
│   │   ├── pois/
│   │   │   ├── pois.module.ts
│   │   │   ├── pois.controller.ts
│   │   │   ├── pois.service.ts
│   │   │   └── importers/
│   │   │       ├── osm-importer.service.ts
│   │   │       ├── google-importer.service.ts
│   │   │       └── foursquare-importer.service.ts
│   │   │
│   │   ├── subscriptions/
│   │   │   ├── subscriptions.module.ts
│   │   │   ├── subscriptions.controller.ts
│   │   │   ├── subscriptions.service.ts
│   │   │   ├── apple-iap.service.ts
│   │   │   ├── google-billing.service.ts
│   │   │   └── stripe.service.ts
│   │   │
│   │   ├── notifications/
│   │   │   ├── notifications.module.ts
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── fcm.service.ts
│   │   │   ├── notification.processor.ts
│   │   │   └── templates/
│   │   │       ├── match.template.ts
│   │   │       ├── message.template.ts
│   │   │       └── hotspot.template.ts
│   │   │
│   │   ├── anonymous/
│   │   │   ├── anonymous.module.ts
│   │   │   ├── anonymous.controller.ts
│   │   │   └── anonymous.service.ts
│   │   │
│   │   ├── safety/
│   │   │   ├── safety.module.ts
│   │   │   ├── safety.controller.ts
│   │   │   ├── panic.service.ts
│   │   │   ├── stalker-detection.service.ts
│   │   │   └── moderation.service.ts
│   │   │
│   │   ├── blocks/
│   │   ├── reports/
│   │   ├── seals/
│   │   ├── boosts/
│   │   └── webhooks/                         # Endpoints webhook
│   │       ├── apple-webhook.controller.ts
│   │       ├── google-webhook.controller.ts
│   │       └── stripe-webhook.controller.ts
│   │
│   ├── common/                            # Compartilhado
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── premium.guard.ts
│   │   │   └── verified.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── cache.interceptor.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   └── premium.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   └── utils/
│   │       ├── geo.util.ts
│   │       └── date.util.ts
│   │
│   ├── config/
│   │   ├── configuration.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── jwt.config.ts
│   │   └── env.validation.ts
│   │
│   ├── database/
│   │   ├── prisma.service.ts             # Prisma client wrapper
│   │   ├── migrations/                    # SQL migrations
│   │   │   ├── 001_initial_schema.sql
│   │   │   └── ...
│   │   └── seeds/
│   │       ├── interests.seed.ts
│   │       └── pois.seed.ts
│   │
│   ├── redis/
│   │   ├── redis.service.ts
│   │   ├── redis.constants.ts
│   │   └── redis.providers.ts
│   │
│   ├── queues/                            # Bull queues
│   │   ├── notifications.queue.ts
│   │   ├── expiration.queue.ts
│   │   ├── cleanup.queue.ts
│   │   └── imports.queue.ts
│   │
│   ├── health/
│   │   └── health.controller.ts            # /health endpoint
│   │
│   └── templates/                         # Email templates
│       ├── welcome.hbs
│       ├── match.hbs
│       └── expired.hbs
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── nest-cli.json
├── tsconfig.json
├── package.json
└── README.md
```

---

## 📦 packages/shared-types/

Tipos compartilhados entre mobile e backend.

```
packages/shared-types/
├── src/
│   ├── user.ts
│   ├── match.ts
│   ├── message.ts
│   ├── location.ts
│   ├── poi.ts
│   ├── subscription.ts
│   ├── api/                             # Tipos de request/response
│   │   ├── auth.types.ts
│   │   ├── users.types.ts
│   │   ├── matches.types.ts
│   │   └── messages.types.ts
│   ├── socket/                          # Tipos de WebSocket
│   │   ├── events.types.ts
│   │   └── payloads.types.ts
│   └── index.ts
├── tsconfig.json
└── package.json
```

**Uso:**
```typescript
// Em qualquer app
import { User, Match } from '@cruzei/shared-types';
```

---

## 🛠️ packages/shared-utils/

Funções utilitárias compartilhadas.

```
packages/shared-utils/
├── src/
│   ├── geo/
│   │   ├── geohash.ts
│   │   ├── distance.ts
│   │   └── bbox.ts
│   ├── date/
│   │   ├── time-ago.ts
│   │   └── format.ts
│   ├── validation/
│   │   ├── email.ts
│   │   ├── phone.ts
│   │   └── cpf.ts                       # se necessário
│   ├── format/
│   │   ├── currency.ts                  # BRL
│   │   └── text.ts
│   └── index.ts
├── tsconfig.json
└── package.json
```

---

## 🎨 packages/ui-mobile/ (Design System)

Componentes com Storybook.

```
packages/ui-mobile/
├── src/
│   ├── Avatar/
│   │   ├── Avatar.tsx
│   │   ├── Avatar.stories.tsx
│   │   └── index.ts
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.stories.tsx
│   │   └── index.ts
│   ├── Card/
│   ├── Chip/
│   ├── Modal/
│   ├── Photo/
│   ├── Seal/
│   ├── Timer/
│   ├── theme/
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   └── index.ts
│   └── index.ts
├── .storybook/
├── tsconfig.json
└── package.json
```

---

## ⚙️ packages/eslint-config/

```
packages/eslint-config/
├── base.js
├── react-native.js
├── nestjs.js
├── node.js
├── package.json
└── index.js
```

**Uso:**
```javascript
// apps/mobile/.eslintrc.js
module.exports = {
  extends: ['@cruzei/eslint-config/react-native'],
};
```

---

## ⚙️ packages/tsconfig/

```
packages/tsconfig/
├── base.json
├── react-native.json
├── nestjs.json
├── node.json
└── package.json
```

---

## 🐳 docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:15-alpine
    container_name: cruzei-postgres
    environment:
      POSTGRES_USER: cruzei
      POSTGRES_PASSWORD: cruzei_dev
      POSTGRES_DB: cruzei
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./apps/backend/src/database/migrations:/docker-entrypoint-initdb.d

  redis:
    image: redis:7-alpine
    container_name: cruzei-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  postgres_data:
  redis_data:
```

---

## 🚀 turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

## 📋 pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

---

## 🧪 Estrutura de Testes

```
apps/backend/test/
├── unit/
│   ├── auth.service.spec.ts
│   ├── match-context.spec.ts
│   └── ...
├── integration/
│   ├── auth.e2e.spec.ts
│   ├── location.e2e.spec.ts
│   └── ...
└── fixtures/
    ├── users.fixture.ts
    └── pois.fixture.ts
```

**Padrão:**
- Unit: testa função isolada, mock tudo
- Integration: testa com DB real (docker)
- E2E: testa fluxo completo via HTTP/WS

---

## 📜 Convenções de Nome

### Arquivos

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Componente | PascalCase.tsx | `Avatar.tsx` |
| Service | camelCase.service.ts | `auth.service.ts` |
| Controller | camelCase.controller.ts | `auth.controller.ts` |
| DTO | kebab-case.dto.ts | `login.dto.ts` |
| Hook | camelCase.ts (use prefix) | `useAuth.ts` |
| Test | *.spec.ts | `auth.service.spec.ts` |
| Migration | NNN_description.sql | `001_initial_schema.sql` |

### Pastas

- `kebab-case` para pastas
- `PascalCase` pra componentes isolados em pastas próprias
- `camelCase` pra módulos de feature

### Git

- Branches: `feature/auth-flow`, `fix/map-crash`, `chore/deps-update`
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`)
- PRs: 1 feature por PR, máximo 400 linhas

---

## 🚦 Como Adicionar uma Feature

Exemplo: adicionar feature de "selos premium":

```
1. types: packages/shared-types/src/seal.ts
2. backend module: apps/backend/src/modules/seals/
3. backend endpoints: /seals, /seals/:id/complete
4. backend DB: migration 002_add_seal_tier.sql
5. mobile screens: apps/mobile/src/screens/Seals/
6. mobile components: apps/mobile/src/components/Seal/
7. mobile stores: apps/mobile/src/stores/sealsStore.ts
8. mobile API: apps/mobile/src/services/api.ts (add methods)
9. tests: apps/backend/test/unit/seals.spec.ts
10. stories: packages/ui-mobile/src/Seal/Seal.stories.tsx
```

---

## 🔧 Como Rodar Local

```bash
# Setup
pnpm install
docker-compose up -d                    # Postgres + Redis

# Backend
pnpm --filter backend dev               # http://localhost:3000

# Mobile
pnpm --filter mobile start              # iOS sim
pnpm --filter mobile android            # Android

# Migrations
pnpm --filter backend db:migrate
pnpm --filter backend db:seed

# Testes
pnpm test                               # tudo
pnpm --filter backend test              # só backend
pnpm --filter mobile test               # só mobile

# Lint + typecheck
pnpm lint
pnpm typecheck

# Storybook
pnpm --filter ui-mobile storybook       # http://localhost:6006
```

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [14-roadmap-lancamento.md](./14-roadmap-lancamento.md)
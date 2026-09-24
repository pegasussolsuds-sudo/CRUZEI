# Cruzei — Conexões reais de lugares reais

> Quem você quase conheceu hoje.

Monorepo do **Cruzei**, o app de encontros baseado em cruzamentos reais.
Você vê no mapa quem esteve no mesmo lugar que você — bar, parque, café — e
só daí surge o match. Chat expira em 48h pra forçar a ação.

## Stack

- **Mobile:** React Native 0.74 + Expo Modules, TypeScript, Zustand, TanStack Query, Mapbox GL, Socket.io
- **Backend:** NestJS 10 + Prisma 5 + PostgreSQL 15 (PostGIS) + Redis 7 + Socket.io
- **Packages compartilhados:** shared-types, shared-utils, eslint-config, tsconfig, ui-mobile (Storybook)
- **Infra:** pnpm workspaces + Turborepo, Docker Compose pra dev local

## Estrutura

```
cruzei/
├── apps/
│   ├── mobile/       # React Native (iOS + Android)
│   ├── backend/      # NestJS API
│   └── admin/        # Next.js (futuro)
├── packages/
│   ├── shared-types/ # Tipos cross-app
│   ├── shared-utils/ # Geo, date, validation
│   ├── eslint-config/
│   ├── tsconfig/
│   └── ui-mobile/    # Design system com Storybook
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

## Quick start

```bash
# 1. Instala deps
pnpm install

# 2. Sobe Postgres + Redis (PostGIS habilitado)
docker compose up -d

# 3. Roda migrations e seed
pnpm --filter @cruzei/backend prisma:migrate
pnpm --filter @cruzei/backend prisma:seed

# 4. Sobe backend + mobile em paralelo
pnpm dev

# Ou individualmente:
pnpm backend:dev
pnpm mobile:start
```

## Documentação completa

Toda a documentação de produto, design e negócio está em `../`:

| Para | Ler |
|------|-----|
| Founder | `01-visao-geral.md`, `02-problema-solucao.md`, `05-modelo-negocio.md`, `16-pitch-deck.md` |
| Engenheiro | `07-arquitetura-tecnica.md`, `13-estrutura-pastas.md`, `08-schema-banco-dados.md`, `09-api-endpoints.md`, `10-geolocalizacao-presenca.md` |
| Designer | `15-wireframes.md`, `17-design-system.md`, `06-identidade-visual.md` |
| Growth | `01`, `03`, `11-marketing.md`, `18-glossario.md` |

## Comandos úteis

```bash
pnpm dev                # tudo
pnpm typecheck          # type-check em todos os packages
pnpm lint               # ESLint em todos os packages
pnpm test               # Jest em todos os packages
pnpm clean              # limpa tudo
```

## Status

✅ **Marco 1 — MVP funcional validado em device (23/09/2026).** Ver `RELATORIO_SESSAO_23-09-2026.md` §10.
Auth, perfil, mapa, presença (geohash + Redis), matches com contexto, chat 48h.

✅ **Marco 2 — mapa 3D vivo (Mapbox GL JS, camadas GL, tema Day/Dusk/Night) + redesign premium (Reanimated 3 + Skia + Moti) validados no Motorola (24/09/2026).** Ver §11 do relatório: Splash, Welcome, Phone, Code, ProfileSetup, PhotoUpload, Map (bottom sheet, hotspots, boost), Match, Chat, Premium, Boost e UserCard.

✅ **Marco 3 — universo social (24/09/2026).** Avatar Cruzei vetorial e modular (catálogo com tiers, customizador, mesmo desenho no app e no mapa), pessoas como personagens no mapa com clusters, sheets de pessoa/lugar, acenar, match físico no mapa ("🔥 CRUZEI!"), eventos, dicas de descoberta e privacidade por degraus (posição borrada, distância aproximada, anônimos fora do mapa). Ver §12 do relatório.

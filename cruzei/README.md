# Metch (ex-Cruzei) — Conexões reais de lugares reais

> Quem você quase conheceu hoje.

Monorepo do **Metch** (marca nova desde 25/09/2026; o codinome técnico continua `cruzei` — ID nas lojas `app.metch` desde 28/09/2026; scopes `@cruzei/*`), o app de encontros baseado em cruzamentos reais.
Você vê no mapa quem esteve no mesmo lugar que você — bar, parque, café — e
só daí surge o match. Chat expira em 48h pra forçar a ação.

## Stack

- **Mobile:** React Native 0.86 + Expo SDK 57 (arquitetura nova), React 19, TypeScript, Zustand, TanStack Query, MapLibre (mapa nativo, tiles OpenFreeMap + prédios próprios), Socket.io
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

# 3. Aplica as migrations (executor próprio, ver "Banco de dados") e o seed
pnpm --filter @cruzei/backend db:migrate
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

## Ambiente do backend

- Copie `.env.example` pra `apps/backend/.env`. **`NODE_ENV` é obrigatório** (`development`, `test` ou `production`): sem ele o backend não sobe.
- Dev com o código do SMS no app/painel e o recibo "dev" do Premium/Boost: `NODE_ENV=development` + `DEV_SHORTCUTS=true` (com qualquer outro `NODE_ENV` o boot recusa). Os scripts `apps/backend/test/*-audit.ts` precisam disso.
- Produção recusa subir com `JWT_SECRET`, `LOCATION_SALT` ou `PHONE_HASH_SECRET` fracos (< 32 caracteres, de exemplo ou repetidos), `ALLOWED_ORIGINS` sem https ou com `*` e a senha de exemplo do Postgres. A mensagem lista só os nomes. `ALLOW_DEV_RECEIPTS=true` (beta fechado) é aceito, mas avisa em todo boot.
- SMS do login (`SMS_DRIVER`): `log` no dev (não manda nada); produção exige `twilio` ou `zenvia` (HTTPS direto, sem SDK) com as credenciais. Tetos, trava por código errado e o número de revisão das lojas (`REVIEW_PHONE` + `REVIEW_CODE`, nunca manda SMS) estão comentados no `.env.example`. Config de SMS errada derruba o boot em qualquer ambiente.
- Fotos (`STORAGE_DRIVER`): `local` (padrão, disco servido em `/uploads`) ou `s3` (Cloudflare R2/AWS S3 por HTTPS, sem SDK). Toda foto é reprocessada (sem EXIF/GPS) e o banco guarda só a chave; a URL sai de `STORAGE_PUBLIC_BASE_URL`, obrigatória (https) em produção. Celular na LAN do dev: `PUBLIC_BASE_URL=http://<ip>:3000`.

## Banco de dados (migrations)

As migrations são SQL puro em `apps/backend/prisma/migrations/<14 dígitos>_<nome>/migration.sql` e quem aplica é o executor do projeto (`apps/backend/src/database/migrate`), não o Prisma. O `schema.prisma` serve só pro client: **nunca** rode `prisma migrate dev`, `migrate deploy`, `migrate reset` ou `db push`. Eles não conhecem PostGIS, `place_*`, índices parciais e gatilhos, e o `migrate dev` oferece apagar o banco.

```bash
cd apps/backend
pnpm db:migrate                 # aplica as pendentes, em ordem (--dry-run lista sem aplicar; --up-to <nome> para antes)
pnpm db:migrate:status          # aplicada / PENDENTE / ALTERADA / SEM ARQUIVO (--check sai com 1 se não estiver em dia)
pnpm db:migrate:new <nome>      # cria a pasta com o modelo e o próximo prefixo
pnpm db:migrate:baseline        # uma vez, em banco montado antes do executor (ver abaixo)
pnpm db:migrate:repair <nome>   # grava o checksum novo de uma aplicada (só se mudou comentário, depois de revisar)
pnpm test:db:setup              # recria o cruzei_test do zero pelo executor (antes do pnpm test:db)
```

Como funciona:
- O histórico fica na tabela `schema_migrations` (nome, sha256 do arquivo, quando, quem e se veio do baseline).
- Cada arquivo roda numa transação só: se der erro, nada daquele arquivo fica no banco e as anteriores continuam. O `BEGIN;`/`COMMIT;` do arquivo é opcional (o executor ignora). `ROLLBACK`, `SAVEPOINT` e `SET` de sessão são recusados; use `SET LOCAL`. O `CREATE INDEX CONCURRENTLY` precisa de `-- migrate:no-transaction` no cabeçalho e de um arquivo idempotente.
- Cada transação usa `SET LOCAL lock_timeout` (padrão `15s`, `MIGRATE_LOCK_TIMEOUT`). Um `ALTER TABLE` preso atrás do app desiste em vez de travar a fila; é só rodar de novo. O teto por arquivo é de 30 min (`MIGRATE_TX_TIMEOUT_MS`).
- Um advisory lock impede que duas execuções ao mesmo tempo (dois deploys) apliquem a mesma migration.
- O executor recusa rodar se um arquivo aplicado mudou (checksum), se um aplicado sumiu da pasta ou se uma pendente é mais antiga que a última aplicada (`--allow-out-of-order` libera, depois de conferir). **Migration aplicada não se edita: crie outra.**
- URL: `MIGRATE_DATABASE_URL` (papel com DDL, conexão direta, sem pgbouncer) ou `DATABASE_URL`. O log mostra só `host:porta/banco`.

Banco que já existia (montado com `psql` antes do executor): rode `pnpm db:migrate:baseline` uma vez. Ele monta um banco temporário `<banco>_baseline_check` do zero pelas migrations, compara o catálogo (tabelas, colunas, índices, constraints, gatilhos, funções, enums, extensões) e só marca como aplicado, sem executar, se bater. Se não bater, mostra a diferença e não marca nada. Migration só de dados (backfill, UPDATE) não aparece no catálogo, por isso o baseline recusa enquanto houver alguma desse tipo entre as que marcaria (no meio ou no fim) e lista todas: confira no banco e confirme as que já rodaram com `--assume-data <nome>…`; a que não rodou, marque até a anterior com `--up-to` e deixe o `db:migrate` aplicar (a mensagem diz os passos). Banco que já tem histórico também é recusado (lá se usa `db:migrate`). O dev foi marcado assim em 05/10/2026, até `20261005000100_media_objects`.

Produção: a migration é um passo separado do deploy, rodado antes de trocar a versão do app.
1. `pnpm --filter @cruzei/backend build`
2. `pnpm --filter @cruzei/backend db:migrate:prod`, que usa o código compilado e não precisa de ts-node.
3. Sobe a versão nova.

Mudança que o código antigo não entende vai em duas etapas. Exemplo: a `20261005000200_photo_keys` troca URL por chave da foto, e o código antigo ainda devolveria a chave crua. Rode o `db:migrate:prod --up-to` da anterior, publique o código novo e só depois aplique a migration (no caso da `photo_keys`, limpe também o cache `profile:*` do Redis).

## Status

✅ **Marco 1 — MVP funcional validado em device (23/09/2026).** Ver `RELATORIO_SESSAO_23-09-2026.md` §10.
Auth, perfil, mapa, presença (geohash + Redis), matches com contexto, chat 48h.

✅ **Marco 2 — mapa 3D vivo (Mapbox GL JS, camadas GL, tema Day/Dusk/Night) + redesign premium (Reanimated 3 + Skia + Moti) validados no Motorola (24/09/2026).** Ver §11 do relatório: Splash, Welcome, Phone, Code, ProfileSetup, PhotoUpload, Map (bottom sheet, hotspots, boost), Match, Chat, Premium, Boost e UserCard.

✅ **Marco 3 — universo social (24/09/2026).** Avatar Cruzei vetorial e modular (catálogo com tiers, customizador, mesmo desenho no app e no mapa), pessoas como personagens no mapa com clusters, sheets de pessoa/lugar, acenar, match físico no mapa ("🔥 CRUZEI!"), eventos, dicas de descoberta e privacidade por degraus (posição borrada, distância aproximada, anônimos fora do mapa). Ver §12 do relatório.

✅ **Marco 6 — privacidade de localização (25/09/2026).** O servidor nunca entrega coordenada real, distância ou horário de outra pessoa: descoberta em raio fixo de 350 m com centro na minha presença (o cliente não escolhe centro nem raio), faixas de proximidade, posição visual por célula (~150 m) ou lugar, mínimo de anonimato, descoberta recíproca (Todos / Interesses / Ninguém), áreas privadas + residência automática, intervalo mínimo entre atualizações, rate limit por usuário, histórico grosseiro e curto, WebSocket auditado, background location removida. 17/17 testes de segurança (`apps/backend/test/privacy-audit.ts`). Ver `PRIVACIDADE-LOCALIZACAO.md` e §15 do relatório.

✅ **Marco 5 — identidade híbrida no mapa (24/09/2026).** Cada pessoa no mapa = foto real circular (bolha de identidade) + nome curto ("Leonardo S.") + avatar vivo + estado (online, em alta, match, novo, selecionado). Thumbnails gerados no upload (`sharp`), preferência "Mostrar minha foto no mapa" (privacidade), LOD por zoom (longe = avatar simplificado; perto = foto + nome + status), lazy loading por viewport com fila por prioridade, seleção com destaque, saída com fade, momento do match com as fotos, mesma bolha nas sheets/listas (`IdentityBubble`). Teste de carga com 120 pessoas no Moto g54. Ver §14 do relatório.

✅ **Marco 8 — busca "Onde tá a vibe" (25/09/2026).** Barra de busca premium no topo do mapa + overlay com ranking ao vivo dos lugares (`GET /pois/vibe`: gente agora com piso de anonimato, tendência de 30 min, eventos, vibe score/level), filtros rápidos e categorias, busca de bairros/ruas via Mapbox Geocoding, toque leva a câmera e abre a sheet do lugar. Ver §17 do relatório.

✅ **Marco 7 — marca Metch (25/09/2026).** Identidade animada em Skia: monograma "M" de dois traços que se encontram com faísca magenta, wordmark com gradiente/brilho, splash coreografada numa linha do tempo na UI thread, logo na Welcome, ícones/splash nativos regenerados, textos do app trocados. Ver §16 do relatório.

✅ **Marco 4 — avatares vivos (24/09/2026).** Rig + motor de poses procedurais (idle, walk/run, wave, like, celebrate, match, arrive) com blend, LOD por proximidade, caminhada interpolada entre posições, emotes ligados às ações sociais e perf medida pelos frames reais do Mapbox. Revisão adversarial aplicada (privacidade do /nearby, throttler, foco do Voltar, socket, padding). Ver §13.

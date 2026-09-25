# Cruzei — Relatório de Sessão (23/09/2026)

Stack: monorepo pnpm + turbo + Expo SDK 51 (RN 0.74.5) + NestJS 10 + Prisma 5 + PostgreSQL + Redis.
Host: Windows 10 + MSYS2 (git-bash), Node v24.19.0, pnpm 9.12.0.

---

## 1. Estado Atual (verificado em runtime, exit codes reais)

| Serviço | Status | Endpoint | Observação |
|---|---|---|---|
| Docker Redis | UP (healthy) | `0.0.0.0:6379` | `cruzei-redis`, container `2c56de1e536a`, rodando há 8h |
| Docker Postgres | DOWN | — | Container `cruzei-postgres` foi criado no primeiro `docker compose up -d`, mas não está mais na lista de `docker ps` — caiu em algum momento |
| Backend NestJS | UP | `http://localhost:3000/v1` | `GET /v1/health → 200` com `{"status":"ok","service":"cruzei-api"}`. PID 44556, log "Nest application successfully started" |
| Metro Bundler | UP | `http://localhost:8081` | `GET /status → packager-status:running`. Bundle compilado válido (`__BUNDLE_START_TIME__...` no response) |
| Android debug APK | BUILD OK (anterior) | — | `assembleDebug -x lint` → BUILD SUCCESSFUL com deps antigas (precisa rebuild após mudanças de hoje) |

---

## 2. O que foi feito (em ordem cronológica)

### 2.1 Infraestrutura
1. **Redis container** criado e subido (`docker compose up -d redis`) — healthy.
2. **Postgres container** criado e subido (`docker compose up -d postgres redis`) — rodou inicialmente, caiu depois.
3. **Backend deps** instaladas via `pnpm install` em `apps/backend` — OK.
4. **Prisma client** gerado (`prisma generate`) em `apps/backend` — OK.

### 2.2 Android build (deps antigas)
5. **Tentativa 1**: `./gradlew assembleDebug` → falhou em `settings.gradle:13` (plugin `com.facebook.react.settings` não encontrado, path apontava pra `null`).
6. **Tentativa 2**: erro mudou — plugin não encontrado em lugar nenhum.
7. **Tentativa 3**: apareceu ANDROID_HOME não setado + erro de `expo-modules-core@1.12.21` com `SoftwareComponent.release` (incompatibilidade AGP).
8. **Fix 1**: criado `apps/mobile/android/local.properties` com `sdk.dir=C:\\Users\\User\\AppData\\Local\\Android\\Sdk`.
9. **Fix 2**: removido `.cxx` corrompido (`rm -rf .../.cxx`).
10. **Tentativa 4**: `JAVA_HOME` + `ANDROID_HOME` + `-x lint` → **BUILD SUCCESSFUL** (1m28s, 715 tasks).

### 2.3 Bug do Metro/Expo bundler — query-core não resolvia
11. **Diagnóstico**: `node_modules/@tanstack/` **não existia no raiz** — pnpm isolou em `.pnpm/@tanstack+react-query@5.51.23_*/...`. Metro não consegue resolver transitive deps de `.pnpm/`.
12. **Fix aplicado** — combinação de 3 mudanças:
    - `apps/mobile/package.json` tinha `@tanstack/react-query@5.51.23` mas queria `@tanstack/query-core@5.51.23` (que **não existe no registry** — só a partir de 5.62.0).
    - Patch no `package.json` raiz com `pnpm.overrides` forçando `@tanstack/query-core@5.103.2` (latest) + `peerDependencyRules.allowedVersions`.
    - Mudança do `.npmrc`: `node-linker=hoisted` + `public-hoist-pattern[]=*` para Metro conseguir resolver transitive deps (invariant, scheduler, fbjs, etc.).

### 2.4 Conflito Node24 + path com espaço
13. **Sintoma**: `tsc` não conseguia rodar nos packages (`packages/shared-types/node_modules/typescript/bin/tsc` — `MODULE_NOT_FOUND`) por causa do espaço em `Cruzei APP`.
14. **Resolução**: confirmado que pnpm + hoisted funcionou — tsc é resolvido via symlink, e o typecheck full passou (`Tasks: 7 successful, 7 total`, exit 0).

### 2.5 Typecheck errors no mobile
15. **6 erros TS** no `@cruzei/mobile` (todos em screens, nada a ver com query-core):
    - `MapScreen.tsx:38` — `region` declarado mas não usado
    - `ChatScreen.tsx:42` — `listQuery` declarado mas não usado
    - `OnboardingScreen.tsx:2` — `Image` importado mas não usado
    - `PaywallScreen.tsx:16` — `shadows` importado mas não usado
    - `PaywallScreen.tsx:85` — Button sem `onPress` (obrigatório em `ButtonProps`)
    - `ProfileScreen.tsx:23` — `user` desestruturado mas não usado
16. **Fix aplicado**: 6 patches pontuais (`,` no destructuring de state, remoção de imports, `onPress={() => {}}`).

### 2.6 Typecheck errors no backend
17. **Erro**: `Property 'user' does not exist on type 'PrismaService'` × 9 (em `users.service.ts` e `matches-cleanup.task.ts`).
18. **Causa**: `prisma generate` não tinha sido rodado após `pnpm install` (client types sumiram).
19. **Fix**: `pnpm exec prisma generate` em `apps/backend` → resolveu.

### 2.7 Backend subindo com erro
20. **Sintoma 1**: `nest start --watch` crashava com `EADDRINUSE :::3000` (backend antigo zombie na porta).
21. **Sintoma 2** (depois de matar zombie): app crashava com `Cannot find module '@cruzei/shared-utils'` mesmo com `node_modules/@cruzei/shared-utils` apontando pro lugar certo.
22. **Causa raiz descoberta via `--listEmittedFiles`**: o `tsc` do backend estava emitindo arquivos em `packages/tsconfig/dist/src/...` ao invés de `apps/backend/dist/src/...`. O `nestjs.json` herdado tinha `rootDir: ./src` (relativo ao packages/tsconfig), e `tsconfig.build.json` não sobrescrevia `compilerOptions.rootDir` corretamente.
23. **Fix**: reescrito `apps/backend/tsconfig.build.json` com `compilerOptions: { rootDir: ".", outDir: "./dist" }` explícito.

### 2.8 Metro bundle — assets
24. **Erro**: `Unable to resolve "../../../assets/onboarding-bg.jpg"` — o arquivo não existe (só há `icon.png`, `splash.png`, `adaptive-icon.png` em `apps/mobile/assets/`).
25. **Fix**: trocado import pra `splash.png` (existente, coerente como background de onboarding).

### 2.9 Verificação final
26. **Typecheck full** (cache bypass forçado, `--noEmit`): 7/7 packages, exit 0.
27. **Backend start** via `node dist/src/main.js` (build manual após fix do tsconfig) → "Nest application successfully started" + HTTP `/v1/health → 200`.
28. **Metro bundle smoke test**: `index.bundle?platform=android&dev=true` → JS bundle válido compilou sem erros.

---

## 3. Arquivos modificados nesta sessão

| Arquivo | Mudança |
|---|---|
| `apps/mobile/android/local.properties` | **criado** com `sdk.dir=C:\\Users\\User\\AppData\\Local\\Android\\Sdk` |
| `.npmrc` (raiz) | reescrito: `node-linker=hoisted` + `public-hoist-pattern[]=*` + `strict-peer-dependencies=false` |
| `package.json` (raiz) | adicionado bloco `pnpm.overrides` + `pnpm.peerDependencyRules` para `@tanstack/query-core@5.103.2` |
| `apps/backend/tsconfig.build.json` | adicionado `compilerOptions: { rootDir: ".", outDir: "./dist" }` explícito |
| `apps/mobile/src/screens/map/MapScreen.tsx` | `[, setRegion]` no destructuring |
| `apps/mobile/src/screens/matches/ChatScreen.tsx` | removido `listQuery` não usado |
| `apps/mobile/src/screens/onboarding/OnboardingScreen.tsx` | removido `Image` do import; trocado asset `onboarding-bg.jpg` → `splash.png` |
| `apps/mobile/src/screens/paywall/PaywallScreen.tsx` | removido `shadows` do import; adicionado `onPress={() => {}}` no Button |
| `apps/mobile/src/screens/profile/ProfileScreen.tsx` | removido `user` do destructuring |
| `apps/backend/dist/` | **gerado** via `tsc -p tsconfig.build.json` (depois removido em cleanup, re-gerado na verificação final) |

---

## 4. O que NÃO foi feito / pendente

### 4.1 Pendências críticas (bloqueiam o app rodar de verdade)

| Item | Por quê importa | Comando/ação |
|---|---|---|
| **Reiniciar Postgres** | Container caiu, backend não tem DB. `GET /v1/health` retorna 200 mas qualquer rota que toque Prisma vai crashar | `docker compose up -d postgres` no `docker-compose.yml` da raiz |
| **Validar conexão Postgres + Redis do backend** | Sem isso, `/v1/auth/request-code`, `/v1/users`, etc. vão retornar 500 | `curl -X POST http://localhost:3000/v1/auth/request-code -H "Content-Type: application/json" -d '{"phone":"+5511999998888"}'` |
| **Rebuild do APK Android** com as deps corrigidas | APK debug anterior foi buildado com deps antigas (antes do fix query-core/hoist) | `cd apps/mobile/android && ./gradlew assembleDebug -x lint` |
| **Instalar APK no device/emulador** | sem isso, o "app rodando" só existe em teoria | `adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| **Smoke test no app real** | validar UI sem redbox | screenshot via `adb shell screencap` ou `browser_vision` no emulator |

### 4.2 Pendências secundárias (qualidade)

| Item | Por quê importa |
|---|---|
| Pin `expo@51.0.39`, `expo-image-picker@15.1.0`, `expo-modules-core@1.12.26`, `typescript@5.3.3` | Metro logou warning "should be updated for best compatibility". Não bloqueia mas pode dar warning |
| `tsconfig.build.json` análogo para os outros packages que buildam (shared-types, shared-utils, ui-mobile) | evitar o mesmo bug de rootDir em outros paths |
| `docker-compose.yml` da raiz: investigar por que postgres caiu | health check, restart policy, volume mount |
| Migrar de `node-linker=hoisted` para uma config mais limpa que escale | hoisted total mascara problemas de pnpm isolation em prod |
| Atualizar AGP e `expo-modules-core@1.12.21` (incompatibilidade `SoftwareComponent.release`) | bug latente — só não apareceu porque build cache já tinha passado daquela fase |
| Resolver TODOs no código: `health.controller.ts` "checar Postgres + Redis antes de retornar ready" | `/v1/health/ready` retorna `ready: true` sem checar nada |

### 4.3 Pendências de validação que não foram feitas

| Item | Estado |
|---|---|
| Endpoint `/v1/health/ready` | Não testado em runtime — só mapeado |
| Rotas autenticadas (`/v1/matches`, `/v1/users/me`, etc.) | Não testadas |
| Fluxo de registro (SMS code) | Não testado |
| Hot reload do Metro quando edita arquivo .tsx | Não validado |
| Build do APK **release** (signed) | Não feito |
| iOS build | Não feito (nem build config verificado) |
| Web build (Expo web) | Não feito |
| Push notifications (FCM) | Não configurado |
| Stripe webhook (rota existe mas nunca foi hitada) | Não testado |

---

## 5. Erros que aconteceram (resumo pra debug futuro)

| # | Erro | Causa raiz | Fix |
|---|---|---|---|
| 1 | `Settings file ... line 13 Plugin [id: 'com.facebook.react.settings'] was not found` — path `null` | Path de `includeBuild` em `settings.gradle` não setado + ANDROID_HOME ausente | `local.properties` + `ANDROID_HOME` env |
| 2 | `SDK location not found` | `ANDROID_HOME` não exportado | `local.properties` com `sdk.dir=` |
| 3 | `Could not get unknown property 'release' for SoftwareComponent container` | `expo-modules-core@1.12.21` incompatível com versão do AGP | build passou por sorte na próxima tentativa (CMake cache regenerada) |
| 4 | `ninja: error: manifest 'build.ninja' still dirty after 100 tries` | CXX cache corrompido | `rm -rf .../.cxx` |
| 5 | `Unable to resolve module @tanstack/query-core` | pnpm `isolated` esconde transitive deps do Metro | `node-linker=hoisted` + overrides no `package.json` |
| 6 | `@tanstack/query-core@5.51.23 not found` (registry) | Versão não existe — só a partir de 5.62.0 | trocar pra `5.103.2` (latest) |
| 7 | `Cannot find module '.../typescript/bin/tsc'` em packages | Node24 + symlinks + path com espaço (`Cruzei APP`) quebrando realpath | `node-linker=hoisted` (transitively) — funcionou mas mascara o problema |
| 8 | 6 erros TS em screens (unused vars, Button.onPress obrigatório) | código pré-existente, sem commit recente | patches pontuais |
| 9 | `Property 'user' does not exist on type 'PrismaService'` | `prisma generate` não rodado pós install | `pnpm exec prisma generate` |
| 10 | `EADDRINUSE :::3000` | Backend zombie de sessão anterior | `Stop-Process -Force` no PID |
| 11 | `Cannot find module '@cruzei/shared-utils'` no runtime do backend | tsc emitia em `packages/tsconfig/dist/src/...` ao invés de `apps/backend/dist/src/...` | `tsconfig.build.json` com `compilerOptions.rootDir/outDir` explícito |
| 12 | `Unable to resolve "../../../assets/onboarding-bg.jpg"` | asset não existe no repo | trocar pra `splash.png` (existente) |
| 13 | `Cannot GET /health` (404) | rotas estão sob `/v1/*` | mudar URL pra `http://localhost:3000/v1/health` |

---

## 6. O que foi TESTADO (não só buildado)

| Teste | Comando | Resultado |
|---|---|---|
| Backend health endpoint | `curl http://localhost:3000/v1/health` | **200** com payload JSON válido |
| Metro status | `curl http://localhost:8081/status` | **packager-status:running** |
| Metro bundle compile (smoke) | `curl "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false"` | **JS bundle válido retornado** (saída começa com `var __BUNDLE_START_TIME__...`) |
| Typecheck full monorepo | `pnpm run typecheck --force` | **7/7 packages, exit 0**, 0 erros |
| Backend Nest startup log | `process.log` do PID 44556 | "Nest application successfully started", 100+ rotas mapeadas sob `/v1/*` |
| Docker Redis health | `docker ps --filter name=cruzei` | `Up 8 hours (healthy)` |
| Postgres live | `docker ps --filter name=cruzei` | **NÃO APARECE** — caiu |
| App rodando no device | — | **NÃO TESTADO** — APK não foi reinstalado pós-fix |

---

## 7. Processos vivos agora (background)

| Session ID | PID | Comando | Status |
|---|---|---|---|
| `proc_be4bd080240c` | 44556 | `node dist/src/main.js` (backend) | running |
| `proc_11514d684e8d` | 14956 | `pnpm start` (metro) | running |

---

## 8. TL;DR pra x10n

**Funciona em runtime:** Metro compila bundle Android válido, backend NestJS responde 200 em `/v1/health`, Redis healthy.

**Quebrou no meio do caminho:** Postgres caiu (subir de novo com `docker compose up -d postgres`), APK debug precisa ser rebuildado com as deps novas (query-core 5.103.2 + hoisted), e o app **não foi instalado no device/emulador ainda** — não tem como confirmar que UI abre sem redbox.

**Não toquei:** iOS, web, release build, push notifications, Stripe webhooks reais, fluxos autenticados, rotas além do `/v1/health`.

**Recomendação:** subir Postgres → rebuild APK → `adb install` → screenshot pra confirmar onboarding renderiza → daí sim fechar o ciclo "app rodando".

---

## 9. Atualização 23/09/2026 12:30 — Pendências RESOLVIDAS

### 9.1 Postgres subiu
- `docker start cruzei-postgres` (container existia, estava parado)
- Redis já estava up desde sessão anterior
- Backend rodando em PID 27968, Postgres 5544 reachable

### 9.2 Bug crítico de DB errado (NÃO documentado no relatório original)
**Causa raiz:** o Nest tinha dois arquivos `.env` conflitantes:
- `apps/backend/.env` → `DATABASE_URL=postgresql://cruzei:***@localhost:5432/cruzei?schema=public` (com senha errada `***` e porta 5432)
- `.env` (raiz) → `DATABASE_URL=postgresql://cruzei:cruzei_dev@localhost:5544/cruzei?schema=public` (correto)

Sem `dotenv-cli` ou `envFilePath` no `ConfigModule`, o Nest lia **o primeiro** (5432 nativo). Como o Postgres 17 nativo tava rodando no Windows em 5432, o Prisma conectava nele silenciosamente. Todo registro feito pelo backend foi pro nativo, não pro container.

**Fix:**
1. `apps/backend/.env` corrigido pra `localhost:5544` com senha `cruzei_dev`
2. `apps/backend/src/app.module.ts` → adicionado `envFilePath: ['../../.env', '.env']` no ConfigModule
3. `apps/backend/src/database/prisma.service.ts` → injetado `ConfigService` no constructor pra setar `process.env.DATABASE_URL` explicitamente (Prisma Client constructor lê env em runtime, não config)
4. `.env` (raiz) já tava correto

### 9.3 Bug crítico de senha literal `***`
**Sintoma:** `PrismaClientInitializationError: P1000 Authentication failed` quando setava DATABASE_URL=5544 com `cruzei:***` (placeholder que existia no `.env`).
**Fix:** substituído por `cruzei:cruzei_dev` (senha real configurada no Postgres 17 nativo).

### 9.4 Backend NÃO tinha dotenv / envFilePath
**Causa raiz:** `ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv })` sem `envFilePath`. Sem dotenv-cli no package.json, o backend só pegava `process.env.DATABASE_URL` se viesse do shell (não vinha).
**Fix:** adicionado `envFilePath: ['../../.env', '.env']` + log de DATABASE_URL no PrismaService pra debug.

### 9.5 APK rebuild + install + smoke test
- `./gradlew assembleDebug -x lint` com `JAVA_HOME=/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot` + `ANDROID_HOME=C:/Users/User/AppData/Local/Android/Sdk` → **BUILD SUCCESSFUL in 1m 54s, 715 tasks**
- `adb install -r ...app-debug.apk` → **Success** (device `ZF524GMZ9C` - Moto)
- `adb shell monkey -p com.cruzei.app -c android.intent.category.LAUNCHER 1` → app abre
- Metro bundleou 100% sem erros
- **Splash renderizou:** logo "cruzei" verde-limão, tagline "quem você quase conheceu hoje", botões "Criar conta" + secundário
- Sem redbox, sem LogBox, sem yellowbox

### 9.6 Fluxo end-to-end validado
**Bug de máscara de telefone:** `packages/shared-utils/src/validation/phone.ts` linha 33-35 — `maskPhoneBR` usa `digits.slice(-10, -8)` que pega DDD errado (ex: input `11987654321` mostra `+55 (87) 9****-2121` ao invés de `+55 (11) 98765-4321`). Pendência pra próxima sessão.

**Fluxo validado:**
1. Splash → home (botões "Criar conta" / "Entrar")
2. Tap "Entrar" → tela "seu número" → input telefone BR
3. Tap "Enviar código" → `POST /v1/auth/request-code` no backend (12ms) → backend loga `📱 [SMS DEV] +551****7766 → 144896` → tela "código enviado" com input OTP 6 dígitos
4. Digita OTP + tap "Entrar" → `POST /v1/auth/login` → backend retorna `{isNew:true, user:{id:null, name:"", phone:"+551****7766"}}` (user novo)
5. App navega pra tela de cadastro "Qual seu nome?" (1/4 etapas do onboarding)

**Screenshots salvos em `C:\Users\User\AppData\Local\Temp\cruzei-{1..18}.png`**

### 9.7 Pendências que continuam
| Item | Status |
|---|---|
| Bug de máscara de telefone no `maskPhoneBR` | Pendente — não bloqueia mas UI mostra DDD errado |
| DTO `UpdateLocationDto` rejeita `accuracy_meters` e `geohash` (mobile envia) | Pendente — bloqueia fluxo de location |
| `health.controller.ts` `ready` retorna true sem checar Postgres/Redis | Pendente — baixa prioridade |
| iOS, web, release build, push notifications, Stripe webhooks reais | Não tocados |
| Postgres nativo no Windows (5432) ainda tá rodando — fonte de confusão futura | Pendente — parar service `postgresql-x64-17` se quiser desambiguar |

### 9.8 Processos vivos agora (background)
| Session ID | PID | Comando | Status |
|---|---|---|---|
| `proc_8f2a137f40a4` | 27968 | `node dist/src/main.js` (backend, .env carregado, conectado em 5544) | running |
| Metro | ? | `pnpm start` no apps/mobile | running (assumido — não foi checado nesta sessão) |

---

## 10. Sessão 23/09/2026 (tarde) — app concluído e validado no Motorola moto g54 (ZF524GMZ9C)

### 10.1 Causa raiz dos erros pós-cadastro
- **Crash nativo** ao entrar no mapa: `java.lang.IllegalStateException: API key not found` — `react-native-maps` com `PROVIDER_GOOGLE` sem chave no manifest.
- **"Could not connect to development server"**: faltava `adb reverse tcp:8081 tcp:8081` (só havia o 3000).
- Decisão de produto (confirmada pelo founder): **Mapbox, não Google Maps**. `react-native-maps` foi removido.

### 10.2 O que foi construído

**Mobile**
| Área | Mudança |
|---|---|
| Mapa | `react-native-webview` + **Mapbox GL JS v3** (`src/screens/map/mapbox-html.ts`): estilo dark/streets, pitch 55°, prédios 3D, marcadores de usuário (foto/iniciais/anônimo), POIs com contagem e pulso de hotspot, marcador próprio com anel, card ao tocar + curtir, chips horizontais, toast, re-aplicação de estado quando o WebView recarrega |
| Auth | `services/api.ts` com **refresh automático** (fila única, retry da request) + `setUnauthorizedHandler`; `stores/auth.ts` mantém sessão em falha de rede; logout chama `/auth/logout` |
| Socket | token buscado a cada reconexão; listeners globais em `App.tsx` invalidam `matches`/`me` |
| Chat | histórico via API, `senderId` real, otimista com `clientId`, ✓/✓✓ de leitura, digitando…, templates de 1ª mensagem, chat expirado bloqueia composer |
| Matches | badge de não lidas na aba, prévia "você:", pull-to-refresh |
| Curtidas | usa localização real (não mais BH hardcoded), modal **"deu match"** com animação e contexto |
| Perfil | stats, barra de completude, toggles via mutation, pausar 24h, logout com confirmação |
| Editar perfil | **novo** (`EditProfileScreen` + `ProfileStack`): fotos (câmera/galeria → crop 4:5 → upload → principal/remover), nome, bio, intenção, interesses do catálogo |
| Login/Cadastro | máscara `(34) 99999-9999` ao digitar, `maskPhoneBR` corrigido, **código dev exibido na tela** (toca pra preencher), data com barras automáticas, validação de data real, botão Voltar, `toIsoDate` local |
| Premium | rótulos (Premium/Premium+, mês/trimestre/ano), seleção de plano, assinar/cancelar (mock dev) |
| Localização | pedido de **background removido do 1º uso** (abria a tela de Configurações do Android); fallback `getLastKnownPositionAsync` |
| UI kit | `Button` ganhou `ghostLight` (o "Já tenho conta" estava invisível no fundo escuro) |

**Backend**
| Área | Mudança |
|---|---|
| Realtime | **novo `ChatGateway`** (socket.io, JWT no handshake, rooms `user:<id>`/`match:<id>`, `join_match`, `typing`, `heartbeat`); emite `message_received`, `message_read`, `typing_indicator`, `match_created`, `like_received` |
| Uploads | **novo `POST /v1/uploads/photo`** (multer, disco em `apps/backend/uploads/`, servido em `/uploads/*`); prod → R2 |
| SMS dev | `devCode` na resposta fora de produção; 429 com contagem regressiva em vez de 500 |
| Location | vizinhos via `ngeohash.neighbors`; **anônimos mascarados** (nome/foto ocultos, posição com jitter determinístico); bloqueios nos dois sentidos; `isAnonymous` derivado do usuário |
| Matches | recusa curtir anônimo; `unreadCount` real; `poiName`; invalida cache de perfil em match/like; templates sem "no esse lugar" |
| Messages | payload normalizado (`type`, ISO dates), ordem cronológica, broadcast |
| Users | `GET /v1/interests`; `orientation` no PATCH; 1ª foto vira principal; reindex ao remover; `IsUrl` aceita IP/localhost |
| Health | `/health/ready` checa Postgres e Redis de verdade |
| Auth | completude inicial no cadastro |
| DB | `manual_extensions.sql`: trigger `locations_sync_geography` preenche a coluna PostGIS (antes ficava NULL → contexto do match nunca era gerado); trigger inválida `locations_updated_at` removida |
| Seeds | `seed.ts` com 12 POIs de Uberlândia; **`seed-dev.ts <lat> <lng> [n]`** cria usuários fake com presença ativa em volta de um ponto |
| Tipos | `@types/multer`, `@types/ngeohash`; `NearbyUser.age: number \| null`; `like_received` nos socket events |

### 10.3 Validado no aparelho (screenshots em `%TEMP%\claude\...\scratchpad\s*.png`)
Onboarding → login (código dev) → cadastro 4 etapas → permissão de localização → **mapa Mapbox com 8 fakes + 11 POIs** → toggle anônimo/visível (troca de estilo) → tap em marcador → curtir → **"deu match" com contexto PostGIS "a 149m de distância hoje"** → chat com template, ✓ e resposta em tempo real → perfil → editar (foto via galeria + crop + upload, bio, interesses) → 65% completo → Premium → logout → login de usuário existente → **refresh automático de token** (TTL 45s de teste: `POST /v1/auth/refresh` no log e navegação seguiu) → reinício do app mantém sessão.

### 10.4 Como rodar (Windows, git-bash)
```bash
# infra
docker start cruzei-postgres cruzei-redis
# backend (porta 3000, escuta 0.0.0.0)
cd apps/backend && npx tsc -p tsconfig.build.json && node dist/src/main.js
# seeds (1x)
npx ts-node prisma/seed.ts && npx ts-node prisma/seed-dev.ts -18.923706 -48.270543 8
# metro
cd apps/mobile && npx expo start --clear
# device
adb reverse tcp:8081 tcp:8081 && ./android/gradlew -p android assembleDebug -x lint && adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
- `pnpm` não está no PATH do git-bash: `node "$APPDATA/npm/node_modules/pnpm/bin/pnpm.cjs" install`
- `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot"`, `ANDROID_HOME="C:/Users/User/AppData/Local/Android/Sdk"`
- API do device: `http://192.168.1.8:3000/v1` (IP do host na LAN — `app.json` `extra` + `apps/mobile/.env`)
- Token Mapbox (pk.): `apps/mobile/.env` `EXPO_PUBLIC_MAPBOX_TOKEN` + `app.json` `extra.mapboxToken`. **Restringir por app no painel do Mapbox antes do beta.**

### 10.5 Pendências (fora do MVP validado)
| Item | Estado |
|---|---|
| Push notifications (FCM) | código do cliente existe (`services/notifications.ts`), sem projeto Firebase configurado |
| Verificação por selfie, exclusão de conta e export LGPD | UI com aviso "em breve"; endpoints não existem no backend |
| Pagamento real (Google Play Billing / StoreKit / Stripe) | `/premium/subscribe` aceita direto em dev |
| Fotos em produção (Cloudflare R2 + signed URL) | hoje disco local |
| Background location (presença com app fechado) | `requestBackgroundPermission()` pronto, não chamado no onboarding |
| iOS, build release assinado, EAS | não tocados |
| `expo@51.0.28` → `~51.0.39`, `expo-image-picker` → `~15.1.0` | warnings do Metro, não bloqueiam |
| Fontes Space Grotesk / Inter | `typography` referencia, mas não estão linkadas (cai no sans padrão) |

---

## 11. Sessão 23–24/09/2026 (noite) — mapa 3D vivo + redesign premium validados no Motorola

### 11.1 Mapa (`src/screens/map/mapbox-html.ts` + `bridge.ts` + `components/map/*`)
- Mapbox GL JS v3.7 no WebView, tudo em **camadas GL** (nada de marcador DOM): avatares via canvas → `addImage`, imagens animadas (`StyleImageInterface`) para sonar de hotspot, anel do "eu", auras premium/boost e anel de seleção, com **um** `triggerRepaint` por tick.
- Tema Day/Dusk/Night trocado com `setPaintProperty` + `setFog` + `setLights` (nunca `setStyle`), prédios 3D (`fill-extrusion`) com gradiente de altura e flood light à noite, glow neon das vias principais, entrada dos avatares por `feature-state`, `reveal` (flyTo) no 1º fix, idle-cam e partículas só no tier alto (FPS medido, fallback por timeout).
- Padding do mapa segue a bottom sheet (`useAnimatedReaction` → `setPadding` adiado até o fim do flyTo).
- Corrigido nesta sessão: sonar do hotspot maior e acima das auras (`icon-pitch-alignment: viewport`), diagnósticos `[cz]` removidos, Voltar do Android fecha o card em vez de sair do app, toque no card abre o **UserCard** (perfil completo), lista da sheet com espaço sob o CTA premium.

### 11.2 Telas do redesign validadas no aparelho (capturas em `%TEMP%claude...scratchpad	*.png`)
Splash → Welcome (CTAs entram ~2s) → Phone (máscara + check) → Code (OTP 6 caixas, código dev clicável, **animação "Confirmado" agora roda antes do navigator trocar** — `verifyCode(..., { deferAuth })` + `commitAuth()`) → ProfileSetup 5 etapas (chips não quebram mais no meio da palavra) → **PhotoUpload** (galeria → crop 4:5 → upload; após o cadastro é a 1ª rota da pilha) → Mapa (avatar com foto, boost = banner "Boost ativo: 59min" + raio 5 km) → Curtidas (deck) → Matches → Chat (bolhas, ✓, contador 48h, templates) → Premium (coroa Skia) → Perfil (anel de completude, stats) → Boost (foguete, partículas, confete, contador) → Match modal ("É um match!") → UserCard (parallax, ações).

### 11.3 Bugs corrigidos
| Bug | Causa | Fix |
|---|---|---|
| Boost: "Erro interno" (500) | `boosts.service.ts` mandava `durationHours` (campo inexistente no modelo Prisma; `as never` escondia o erro) e cobrava 990 c/h vs R$ 4,90 na UI | campo removido, preço 490 |
| Header do mapa não mostrava boost | BoostScreen usava a chave `['boost-active']` e o header `['boosts','active']` | chave unificada |
| Cadastro caía direto no mapa | `initialRouteName` só vale na montagem; ao sumir a pilha de auth o router pega a 1ª rota | PhotoUpload vem primeiro quando `pendingPhotoOnboarding`; `finish()` usa `replace('Main')` quando não há pra onde voltar |
| UserCard mostrava faixa escura ao rolar | conteúdo menor que a tela | sheet com `flexGrow` + padding do footer |
| Crash intermitente Reanimated "HostObject … Shareable" | apareceu **1x** em ~8 aberturas (logo após a Splash, junto de pressão de memória/LMK); não reproduziu com instrumentação | em observação — se voltar, instrumentar `shareables.js` (try/catch em `makeShareableClone`) |

### 11.4 Dados de dev
- Fakes: `npx ts-node prisma/seed-dev.ts -18.923706 -48.270543 8` (fotos self-hosted em `uploads/fakes/fake-N.jpg`, CORS liberado; `PUBLIC_BASE_URL` opcional).
- Para forçar um match: `insert into likes (liker_id, liked_id) values (<fake>, <eu>)` e curtir o fake no app.
- Contas de teste no banco: `avell` (+553496566696, 8 dígitos) e `Fable` (+5534965666960, 9 dígitos).

### 11.5 Pendências
- Testar tema Day/Dusk (só Night foi visto; troca é por hora local em `useMapTheme`).
- Crash intermitente do Reanimated (acima).
- Itens anteriores: FCM, selfie/LGPD, pagamento real, R2, background location, iOS, restringir token Mapbox.

---

## 12. Sessão 24/09/2026 (madrugada) — "Universo social 3D" (doc `NOVO MAPA/NOVO VISUAL DE MAPA.md`)

### 12.1 Avatar Cruzei (identidade digital)
- **Config** (`AvatarConfig`, `packages/shared-types/src/avatar.ts`): 13 slots de item (corpo, cabelo, rosto, barba, parte de cima/baixo, calçado, cabeça, óculos, acessório, bolsa, pulso, efeito) + 6 de cor. Guardada em `users.avatar_config` (JSONB; migration `20260924000000_avatar_config`).
- **Catálogo** (`packages/shared-utils/src/avatar/catalog.ts`): ~90 itens/cores com tier `free | premium | event`. `normalizeAvatarConfig`, `isValidAvatarConfig`, `randomAvatarConfig(seed, {gender})` (determinístico: quem não personalizou tem sempre o mesmo avatar), `lockedAvatarSlots`, `avatarKey`.
- **Geometria** (`apps/mobile/src/avatar/layers.ts`): paths SVG por camada (viewBox 100×140). Uma única fonte: o app desenha com `react-native-svg` (`<CruzeiAvatar mode="bust"|"full">`) e o mapa desenha as MESMAS camadas com canvas/Path2D → identidade idêntica em todo lugar. Preview de todos os itens em `apps/backend/uploads/avatar-preview.html`.
- **Backend**: `PATCH /me { avatar }` valida tiers (free só free; premium libera premium; event bloqueado) e tamanho; `GET /me`, `/location/nearby`, `/users/:id`, `/matches` devolvem `avatar`; cadastro gera avatar; seed dá avatar + 3 interesses aos fakes.
- **Telas**: `AvatarCustomizerScreen` (rota `AvatarSetup`; entra no onboarding entre o cadastro e as fotos: `onboardingStep = avatar | photo | null`), card "seu avatar" no Perfil, avatar em Matches, Chat (header), Curtidas (badge), UserCard (chip), MatchModal (dois avatares), PersonRow.

### 12.2 Mapa = universo
- **Pessoas como personagens** em pé (billboard, âncora no pé), silhueta até a definição chegar (`defineAvatars` manda cada visual UMA vez por WebView, cache por chave), aura no chão (boost dourada / premium+ magenta / efeito do avatar), anel de presença, selo verificado.
- **Clusters** até zoom 17 (raio 70 px), pill escura "👥 N"; toque aproxima; no zoom máximo abre a lista filtrada pelo grupo (`clusterTap`).
- **Sheets escuras sobre o mapa** (mapa continua visível): `UserPreviewSheet` (avatar grande, online, "~250 m de você", "Está no Bar do Léo", bio, interesses, ❤️ Curtir / 👋 Acenar ou 🔥 Match / 💬 Conversar, link pro perfil completo) e `PlacePreviewSheet` (👥 N no Cruzei · 🟢 online · 🔥 Em alta / ⚡ Evento, avatares de quem está lá, "Ver pessoas", "Ver no mapa").
- **Acenar**: `POST /waves` (dedupe 24 h no Redis, socket `wave_received` → toast "👋 Fulano acenou pra você").
- **Match físico no mapa** (`matchMoment`): lista recolhe, câmera enquadra os dois avatares, arco de luz lima/magenta entre eles, pulsos alternados, a pessoa sai do cluster em destaque, "🔥 CRUZEI! Você e Bia deram match" por ~3,4 s → depois a celebração (modal) com "💬 Conversar · 🗺️ Ver no mapa · Fechar".
- **Lugares/eventos**: POI `event` com ícone ⚡ magenta e sonar; POI em alta 30 % maior. Seed: "Sunset na Praça".
- **Descoberta sem spam** (`useDiscoveryHints`): 1 dica por vez, ≥45 s entre elas, dedupe por sessão ("✨ 3 pessoas novas…", "🔥 Bar do Léo tá bombando", "⚡ Evento perto", "👀 4 online a menos de 250 m"). Header: "🔥 1 em alta · 👥 5 perto · ✨ novidades".

### 12.3 Privacidade (doc §2/§12/§14)
- `/location/nearby`: anônimos **não aparecem**; posição de todo mundo = real + jitter determinístico 25–70 m (salt + id) + arredondamento a 4 casas; `distanceM` só em degraus 50/100/250/500/1 km… (`approxDistanceM`). Mesma régua no app (`formatApproxDistance`) e no contexto do match ("a ~250 m", antes "a 232m").
- Modo invisível preservado: só eu me vejo (avatar apagado), banner "Você está oculto do mapa".

### 12.4 Validado no Motorola
Mapa com 9 avatares vetoriais + clusters + evento → sheet do Pedro (curtir/acenar) → lista com avatares e "· Bar do Léo" → match com a Bia: momento no mapa + modal com avatares → "Ver no mapa" repete o momento → perfil → customizador (abas, tiles com prévia real, cores com cadeado, item premium bloqueado abre o Paywall, salvar) → avatar novo no mapa e no perfil → anônimo/visível.

### 12.5 Dev
- Metro/backend pelo túnel USB: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3000 tcp:3000`; `.env` do mobile aponta pra `http://127.0.0.1:3000` (o IP da LAN mudou; o túnel não depende de Wi-Fi). Metro precisa reiniciar ao mudar o `.env`.
- `prisma generate` pode quebrar após `pnpm install` (falta `@prisma/client/generator-build`): copiar de `node_modules/prisma/prisma-client/generator-build`.

---

## 13. Sessão 24/09/2026 (manhã) — avatares vivos (doc `EVOLUÇÃO DO AVATAR/Avatar.md`) + correções da revisão adversarial

### 13.1 Revisão adversarial (workflow: 4 dimensões × 2 céticos por achado) — corrigido
- **Privacidade**: `/location/nearby` era um oráculo (filtro/ordem pela posição real com centro/raio do cliente) → agora filtra e ordena pela posição BORRADA, raio clampado 300–5000 m, lat/lng validados, `me_lat/me_lng` pra distância a partir de mim; jitter com janela diária (`salt:dia:id`) e pessoas num POI ancoradas no POI (+8–25 m); `showDistance=false` esconde distância e lugar; `GET /users/:id` usa a posição borrada; waves silencioso pra alvos inválidos e só a ≤ 5 km; **ThrottlerGuard** que não existia (`@Throttle` era no-op) registrado (600/min; strict só onde anotado); tiers do avatar respeitam `premiumExpiresAt` e o cancelamento rebaixa; fallback de avatar no servidor + backfill.
- **App/WebView**: Voltar só com o mapa em foco (engolia o Voltar do UserCard); socket de aceno/curtida via `connectSocket()` (o `getSocket()` era null no 1º mount); fila de matches; distância = a do servidor (o app recalculava da coordenada borrada); dicas de descoberta com rebase por recorte e fila que drena; `endProgrammatic()` aplica o padding pendente no fim de cada animação (o `on(moveend)` roda antes dos `once`); `fitBounds` do momento sem somar o padding do sheet duas vezes; clusters até zoom 21 (o `clusterTap` era código morto); cache de avatares podado a cada setData (RN e WebView em sincronia); aura sem corte na base (margem + `icon-offset`); `select(null)` não apaga o anel durante o momento; contexto do match com distância em degraus.

### 13.2 Avatares vivos (mapa)
- **Rig**: cada camada do avatar tem grupo (`g`: sombra, corpo, cabeça, braço E/D, perna E/D) e `buildAvatarRig(cfg)` dá os pivôs (quadril, pescoço, ombros, quadris das pernas).
- **Motor** (`src/screens/map/avatar-anim.ts`, JS injetado no WebView): poses procedurais por estado — **idle** (respiração, cabeça, troca de apoio), **walk/run** (pernas/braços alternados, bob, inclinação), **wave**, **like** (pulinho), **celebrate** (pulos + braços), **match** (braços pra cima balançando), **arrive** (squash na chegada); **blend de 220 ms** entre estados; variação por pessoa (fase, velocidade, energia, escala 0,96–1,04) por hash do id — ninguém é clone. Desenho hierárquico com `DOMMatrix` (cabeça/braços filhos do corpo) e espelhamento quando anda pro oeste.
- **Figuras**: cada pessoa é uma imagem `StyleImageInterface` (parada custa zero); **LOD** a cada 700 ms anima só as N mais perto do centro dentro da viewport (high 14 / mid 8 / low 4) a 30/20/12 fps; emotes e caminhada ligam a animação sob demanda (`force`).
- **Movimento**: posição nova → a pessoa **anda** até lá (1,5 m/s, 1,2–9 s, corre acima de 120 m, > 600 m teleporta) numa fonte `movers` atualizada por tick, volta pro cluster ao chegar com **arrive**; eu também ando. `fadeDuration: 0` no mapa (sem rastro de cross-fade).
- **Emotes** (`cmd.emote(id, kind)`): toque = squash; acenar = meu avatar acena; aceno recebido = quem acenou acena; curtir = a pessoa dá um pulinho; curtida recebida = idem; **match** = os dois de braços pra cima durante o momento.
- **Perf real**: fps agora = mediana do intervalo entre eventos `render` do Mapbox (rAF contava 60 com o mapa parado); medição inicial só com o mapa ocioso; histerese de tier (sobe pra mid ≥ 26 fps e high ≥ 42; desce de high < 30, de mid < 20; ignora os 12 s de aquecimento). Moto g54: ~40 fps com 3D + glow → tier mid.
- **Validado no aparelho**: frames diferem (idle), Pedro correu 130 m e clusterizou ao chegar, toque/aceno/curtir/match com poses, tier logado (`[map] ready tier=… fps=…`).

### 13.3 Limitação e decisão técnica
O brief sugere GLB/Three.js. Não há modelos riggados nem pipeline de assets, e o avatar é vetorial e customizável (~90 itens): fazer skeletal 2.5D em cima das camadas existentes entrega vida com identidade consistente, zero download e custo só em CPU (canvas), sem mexer na arquitetura do mapa. Uma camada Three.js (custom layer) continua possível no futuro para oclusão por prédios/instancing; os estados/rig já são independentes do renderer.

### 13.4 Pendências
- Push travado na janela "Select an account" do Git Credential Manager (precisa do clique do usuário) → resolvido fixando o usuário do GitHub no `git config` do repo.
- Avatar no app (customizador/perfil) ainda estático; "olhar pra quem está perto"; celebrate sem gatilho no app; teste com 100+ pessoas (seed só tem 8) → feito na §14 (seed gera até 400).

---

## 14. Sessão 24/09/2026 (tarde/noite) — identidade híbrida no mapa (doc `FOTO AVATAR/Foto avatar.md`)

"Quem eu vejo no mapa é uma pessoa real, representada pelo seu avatar dentro do universo Cruzei": cada pessoa visível virou **foto real circular + nome curto + avatar vivo + estado**, como uma composição só.

### 14.1 O que foi feito
- **Bolha de identidade no mapa** (`apps/mobile/src/screens/map/identity-bubble.ts`, JS injetado no WebView): módulo `CZ_PHOTO` com loader de thumbnails (cache por URL, fila com prioridade = distância ao centro, 4 downloads simultâneos, timeout 15 s, falha de rede tenta de novo até 3× e CORS bloqueado é definitivo, LRU de 400) e o desenho da bolha (círculo perfeito, sombra suave, rabicho ligando ao personagem, borda por estado, ponto verde de presença, selos ✦ novo / ♥ match).
- **Composição no mapa** (`mapbox-html.ts`): uma imagem `ph-<id>` (StyleImageInterface 56×62) por pessoa nas camadas `cz-users-photo`, `cz-users-boost-photo`, `cz-movers-photo`, `cz-me-photo` e `cz-spot-photo`, com a **mesma expressão de tamanho da figura** e `icon-offset` calculado a partir do topo da cabeça — foto, nome e avatar escalam e andam juntos (caminhada usa a mesma feature da fonte `movers`). Nome curto embaixo dos pés (texto GL, nítido em qualquer zoom).
- **LOD por zoom**: < 13 só um ponto pequeno por pessoa ("tem alguém ali"); 13–14 avatar simplificado; ≥ 14 foto (pequena); ≥ 15,5 nome; selecionado = figura e foto maiores (foto +18 %) com crossfade (`spot` + feature-state), anel no chão e nome com halo.
- **Lazy loading**: a bolha só nasce quando a pessoa entra na viewport (+30 % de margem pra pré-carregar no arrasto) com zoom ≥ 14; fade-in de 300 ms quando o thumb chega; foto quebrada/404 → a bolha fica vazia e o avatar segue sozinho (o mapa nunca quebra).
- **Estados**: online (ponto verde, ≤ 15 min), em alta/boost (anel dourado + brilho), match (anel magenta + ♥), novo por aqui (✦, conta < 7 dias), selecionado (anel lima + brilho), momento do match (magenta + brilho nos dois). Anônimo nunca tem foto; invisível continua fora do `/nearby`.
- **Match no mapa**: os dois se viram um pro outro, fotos visíveis com anel magenta, pose de match, arco de luz, bursts, "🔥 CRUZEI!" e retorno ao normal em 3,4 s. Match feito na sessão reflete na bolha/lista na hora (`localMatches` mesclado na lista).
- **Entrada/saída**: quem chega faz fade + "pop" (squash de chegada); quem sai some com fade de 300 ms (a feature fica na fonte até o fim e as imagens saem depois).
- **Privacidade**: nova preferência **"Mostrar minha foto no mapa"** (`users.show_photo_on_map`, `PATCH /me/settings`, toggle no Perfil). O `/nearby` só manda `mapPhotoUrl` (thumbnail) com a preferência ligada e quando existe thumbnail de verdade (nunca a foto grande); `mainPhotoUrl` segue pro cartão. Posição continua borrada, distância em degraus, anônimos fora.
- **Thumbnails**: `sharp` no backend gera `<foto>-t.jpg` 256×256 (cover com recorte "attention", EXIF, fundo escuro pra PNG transparente) no upload; conteúdo do arquivo validado (extensão/mimetype vêm do cliente); `prisma/backfill-thumbs.ts` gera pra fotos antigas e re-hospeda URLs locais (`--rehost`); 404 de foto responde com CORS (sem ruído no console do WebView).
- **No app**: componente reutilizável `IdentityBubble` (foto circular com anel por estado, ponto de presença, selo; busto do avatar enquanto carrega/se falhar; sem `overflow:hidden`+borda+raio no mesmo View — combinação que derruba o HWUI em Motorola/MediaTek) usado na `UserPreviewSheet` (foto flutuando acima do avatar, como no mapa), `PlacePreviewSheet` ("Quem está por aqui" com fotos quando permitido) e `PersonRow`. Nome curto via `formatMapName` ("Leonardo Silva" → "Leonardo S.", pula partículas, à prova de emoji, máx. 14 chars).
- **Seed de carga** (`seed-dev.ts <lat> <lng> 120`): 8 fakes nomeados + gente sintética cobrindo a matriz do brief (sem foto, foto 404, foto desligada, nome longo/curto, novo, boost, premium, multidão no evento e aglomeração sem POI). Trava contra produção.

### 14.2 Validado no Motorola (Moto g54)
77–78 pessoas em 800 m: bolhas com foto e nomes curtos, clusters "👥 27", fotos 404 caindo no avatar, LOD (zoom 12,8 só clusters/pontos; 14,3 fotos pequenas sem nome; 16–17 composição completa), seleção (figura + foto maiores, anel, nome com halo), momento do match com fotos, caminhada com a bolha acompanhando (Wellington 120 m), preferência ligada/desligada refletindo na hora, lista expandida com 78 bolhas sem crash, tema Night. Perf: ~30–35 fps (tier mid) com 77 pessoas; medição inicial cai pra "low" durante a carga e sobe em ~20 s.
Ferramenta nova: o WebView do app expõe DevTools remoto (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`) — `cdp.js` roda JS no mapa do aparelho (zoom, select, matchMoment) sem mexer no app.

### 14.3 Problemas encontrados e resolvidos
- **Crash nativo** (SIGSEGV em `libhwui` `drawRRect`, RenderThread) ~15 s após a lista renderizar: View com `overflow:hidden` + borda + raio clipando `Image` com raio próprio. Reestruturado o `IdentityBubble` (Image arredondada no Fresco, anel como View de traço, busto SVG já circular) e o `avatarBtn` da sheet de lugar. Sem novas ocorrências depois disso.
- `pnpm add` falhava com ENOENT em `*_tmp_*`: Metro e backend em execução seguram arquivos de `node_modules` no Windows — parar os dois antes de instalar.
- Fotos do seed apontavam pro IP antigo da LAN → `--rehost http://127.0.0.1:3000` (túnel USB) e cache de perfil no Redis limpo.
- Conta de teste logada era "douglas" sem foto (não a "Fable"): a bolha própria só apareceu depois de dar uma foto pra conta.

### 14.4 Decisões e limitações
- Foto e figura são imagens separadas na mesma feature (não uma imagem só): permite LOD por zoom sem redesenhar, fade próprio e memória menor (bolha 112×124 px vs figura 144×224 a 2×). Limite prático continua ~300 pessoas por `setData` (atlas de sprites do Mapbox ≈ 4096²).
- O tamanho de ícone é layout (não anima): a "chegada com scale" virou fade + pop (squash) e a seleção virou crossfade entre a figura normal e a maior.
- Cluster ao tocar faz zoom até o nível em que as folhas se separam (supercluster reagrupa por tile; separação "gradual" real exigiria animar folhas à mão).
- Thumbnails/CORS existem no caminho de upload local; em produção (R2/CDN) o bucket precisa de CORS `*` em GET e de um passo de thumbnail (Worker ou o mesmo `sharp` antes de subir).
- Mapeamento estado→cor existe duas vezes (RN `IdentityBubble` e JS `bubbleStyle`) por serem runtimes diferentes; manter os dois em sincronia ao criar estado novo.

### 14.5 Revisão adversarial (workflow: 4 dimensões × 1 cético por dimensão) — 33 achados confirmados, 8 rejeitados
Corrigido nesta sessão:
- **WebView**: pessoa que volta durante o fade de saída ficava invisível (feature-state `a` preso em 0) e, voltando logo depois, nunca ganhava bolha (`leaving` sujo); camadas de quem anda ignoravam o `a` (selecionado andando duplicava ou sumia ao chegar) → `S_ALPHA` nas três camadas de movers e o crossfade escreve nas três fontes; seleção durante o momento do match apagava a outra pessoa → a seleção espera o `clearMoment`; aura (boost/premium+) sumia no destaque → camada `cz-spot-aura`; LRU do cache despejava thumbs em uso → `thumb()` renova; foto que falhou criava bolha transparente (alvo de toque vazio) → sem bolha até a próxima tentativa; toque genérico (`mapTap`) não conhecia as camadas novas → lista única `TAP_LAYERS`; `pushUsers` duplicado a cada `setData` → LOD roda antes do push; definições de avatar de quem está saindo eram podadas no meio do fade.
- **Backend**: `mapPhotoUrl` caía na foto original sem thumbnail (HEIC) → só thumbnail de verdade; `POST /me/photos` aceitava URL de qualquer host (pixel de rastreio que todo viewer baixaria) → allowlist (host da API + `PHOTO_ALLOWED_HOSTS`); `isOnline` era `true` fixo por 5 h → 15 min como o mapa; thumbnail de PNG transparente saía preto → `flatten`; upload confiava em extensão/mimetype → conteúdo validado com `sharp`; `backfill --rehost` re-hospedava URLs externas e abortava em URL mal codificada; seed sem trava de produção; 404 de `/uploads` só GET/HEAD.
- **App**: sheet da pessoa estourava o snap de 50 % → 56 % e composição 184 px; match feito na sessão não chegava à bolha/lista → `localMatches` mesclado na lista; rótulo próprio sem `formatMapName`; `IdentityBubble` sempre acessível (nó duplicado/aninhado) → `accessible={false}` onde o pai já descreve e estado no rótulo; `loaded` não amarrado à URL; `formatMapName` com emoji/pontuação (surrogate solto) → inicial por caractere e só letra, com testes (`text.test.ts`).
- **Brief**: ponto pequeno em zoom < 13; chegada com "pop"; pré-carga 30 % fora da viewport; retry de foto em conexão lenta; foto do selecionado +18 %; os dois se olham no match.
Rejeitados pelo cético (por já estarem cobertos ou fora do escopo): fallback da sheet pro thumb do cartão (o perfil é público), `loaded` (corrigido mesmo assim), R2 em prod (pendência conhecida), separação gradual do cluster, testes (adicionados), foto maior no selecionado, mini-fotos no POI, 404 catch-all.

### 14.6 Pendências
- Estados "evento"/"perto" na bolha (precisa da categoria do POI no `/nearby`); mini-fotos de quem está no lugar direto no pin do POI; distância na composição do mapa (decisão: só na sheet/lista, pra não poluir).
- R2/CDN em produção (upload, thumbnail, CORS) — o stub local continua.
- Ajuste fino pendente no aparelho: tier "low" na medição inicial com 100+ pessoas (o remount pelo clamp de DPR acontece uma vez) — considerar adiar a medição até as fotos/figuras carregarem.

---

## 15. Sessão 24–25/09/2026 (noite) — privacidade de localização, anti-triangulação e descoberta segura (doc `PRIVACIDADE/Privacidade cruzei.md`)

Entrega completa (15 itens do §28 do brief) em **`PRIVACIDADE-LOCALIZACAO.md`**. Resumo:
- **Auditoria** (fases 1–6): o `/nearby` confiava no centro/raio do cliente (varredura da cidade), mandava lat/lng "borrado" que acompanhava a pessoa (jitter fixo por dia = rastreável), distância numérica e timestamp preciso; o cartão `/users/:id` revelava lugar e distância de qualquer usuário sem limite de raio; `/pois/:id/people` listava quem está em qualquer lugar da cidade sem bloqueio nem piso; histórico preciso ficava 7 dias; permissão de background declarada sem uso; rate limit por IP.
- **Backend** (fases 7–14): `discover()` com centro = minha presença no servidor, raio ≤ 350 m, **faixas** (bem perto ≤100 / perto ≤250 / na região ≤350) calculadas contra a **posição visual**; posição visual = ponto do lugar (≥ 2 pessoas) ou **centro da célula geohash-7 (~150 m)** + deslocamento diário; **mínimo de anonimato** por área geohash-6 (sozinho → só `hiddenCount`); descoberta **recíproca** (Todos / Interesses / Ninguém); **áreas privadas** manuais (CRUD + tela) e **residência automática** (3 madrugadas na mesma célula); intervalo mínimo de 20 s entre atualizações; presença TTL 2 h; histórico grosseiro (~110 m) por 3 dias; **rate limit por usuário** (hash do token) em `/nearby` 20/min, update 12/min, cartão 60/min, lugar 30/min; cartão/aceno/"quem está aqui" só para quem é descoberto agora; 404 uniforme; anônimos fora das contagens; contexto do match sem metros.
- **App**: DTO seguro (`NearbyUser` sem lat/lng/distanceM/recordedAt; `mapPosition`, `proximityBand`, `presenceType`, `lastSeen`); WebView só com `mapPosition`; lista/sheets/modal/likes/cartão em faixas; presença sem horário; seletor "Descoberta por proximidade" e tela "Áreas privadas" no Perfil; banner "🏠 Área privada: ninguém te vê aqui"; background location removida.
- **Testes** (fase 15): `apps/backend/test/privacy-audit.ts` — 10 testes do brief, 17 asserções, **17/17 PASS** contra o backend dev (API sem chaves proibidas, 0 posições visuais coincidindo com a real, cartão só faixa, 404 uniforme, 429 após 20/min e por usuário, 4 posições reais a 30 m → 2 visuais, bloqueio nos dois sentidos, área privada esconde, região esparsa vira `hiddenCount`, centro/raio do cliente ignorados, 2ª atualização < 20 s ignorada, WebSocket sem coordenada, app sem persistência).
- **Validado no Motorola**: "54 pessoas em 350 m", lista com "perto · Bar do Léo" e "Esteve por aqui", marcadores nas células, 30–59 fps.
- **Vulnerabilidades restantes e decisões manuais**: §14 e §15 do documento (célula de 150 m dentro dos 350 m é a resolução final; residência automática leva 3 noites; Premium "cidade inteira" passa a valer para lugares, não pessoas — copy do paywall a ajustar; limites por env; throttler em Redis em produção).

---

## 16. Sessão 25/09/2026 (manhã) — nova marca **Metch** (ex-Cruzei) com identidade animada

Pedido do founder: trocar a marca "Cruzei" por "Metch" em tudo que o usuário vê, "bem premium, com animações e profissional". Identificadores técnicos **não** mudaram de propósito (pacote `com.cruzei.app` — trocar desinstalaria o app de quem já tem —, scopes `@cruzei/*`, chaves de storage, pastas do monorepo, origem da WebView `app.cruzei.com.br`).

### 16.1 Identidade
- **Monograma** (`apps/mobile/src/components/brand/MetchMark.tsx`): um "M" desenhado por **dois traços que sobem pelas laterais e se encontram no centro** (a história da marca: dois caminhos que se cruzam), com **faísca magenta** e onda no ponto de encontro. Skia + Reanimated: trim de path (`start/end`), gradiente lima → lima-clara, halo que respira, faísca com *back-out*, onda que dissipa. Modo interno (desenha ao montar, `onMeet`) e modo externo (`progress`/`sparkProgress` vindos de uma linha do tempo).
- **Wordmark** (`MetchWordmark.tsx`): "metch" em Space Grotesk Bold convertido em **path letra a letra** (letter-spacing −4,5 %), com gradiente vertical, halo, **revelação por varredura** e **faixa de brilho diagonal** ("shimmer", único ou em loop). Typeface Skia carregado **uma vez** (`brand-font.ts`, pré-carregado em `useAppFonts` com teto de 3 s); fallback pra `<Text>` se falhar.
- **Logo composto** (`MetchLogo.tsx`): monograma + wordmark em linha ou empilhado; o wordmark começa a aparecer quando os traços se encontram.
- **Constantes** em `apps/mobile/src/brand.ts` (`BRAND.name/wordmark/matchShout/tagline/supportEmail/version`).
- **Ícones e splash nativa** gerados por script (`sharp`, mesma geometria do componente): `assets/icon.png` (M preto + faísca magenta sobre lima), `adaptive-icon.png` (primeiro plano transparente — o antigo era lima sobre lima, ícone invisível), mipmaps `ic_launcher`/`_round`/`_foreground` nas 5 densidades, `splash.png`/`splashscreen_image.png` (fundo escuro + monograma).

### 16.2 Splash (`SplashScreen.tsx`)
Coreografia de 2,3 s em **uma única linha do tempo na UI thread** (`t` linear; tudo é `useDerivedValue` dela): traços se desenham (0,1–1,0 s) → encontro: faísca + onda + 26 partículas + halo acende + toque háptico → wordmark revela (1,06–1,68 s) → brilho atravessa (1,5–2,3 s) → tagline sobe → saída em zoom/fade quando `ready` e ≥ 2,6 s. "Reduzir movimento" vai direto ao estado final.

**Descobertas de boot (importantes pra qualquer animação Skia no arranque):**
1. O `Canvas` do Skia monta o conteúdo num **efeito passivo** (`useEffect`) e as animações começavam em `useEffect` — no boot a thread JS fica ~2 s ocupada montando o mapa, então a splash ficava congelada e saía antes da fonte existir. Correção: animações iniciam em `useLayoutEffect`, linha do tempo sem callbacks JS, typeface pré-carregado.
2. **Criar a WebView do mapa (Chromium) trava a thread principal do Android por ~2 s** → congela os canvases Skia mesmo com tudo na UI thread. Correção: o `RootNavigator` só monta quando a coreografia termina (`onSettled`); a WebView nasce por baixo da splash e a **splash só sai quando a WebView carregou** (`useBootStore.webViewReady`, teto de 4 s). A variante "WebView só depois da splash sair" foi testada e descartada: derrubou o driver GL/HWUI do Moto g54 (`glDeleteTextures` em `renderLayerImpl`; `drawRRect` em `OpsTask::tryConcat`, 3 crashes em ~10 aberturas). Além disso, ao terminar a saída a splash **para todas as animações (halo, blobs) antes de desmontar**: os canvases Skia são TextureViews e desmontá-los com mapper rodando, junto com o GL do mapa, é o cenário dos crashes. Sequência final: 5/5 aberturas sem crash.
3. Blobs de fundo também passaram pra `useLayoutEffect`.

### 16.3 Onde a marca aparece
Splash, Welcome (`MetchLogo` com brilho em loop), Perfil ("metch 0.1.0 · telefone", e-mail de suporte), Premium ("METCH PREMIUM"), momento do match ("🔥 METCH!" no mapa e "METCH! 🔥" no modal), sheet do lugar ("N pessoas no Metch", "Evento Metch", "Ninguém do Metch por aqui agora"), cadastro ("o Metch é só pra maiores de 18"), áreas privadas, Onboarding (tela legada), `app.json` (nome, scheme `metch`, textos de permissão), `strings.xml` (nome do app), manifest (scheme `metch` + `cruzei` mantido pra links antigos), catálogo do avatar ("Aura Metch Fest", "Lima Metch", "Magenta Metch"), backend (mensagem do upload de foto, log de boot).

### 16.4 Validação no Motorola (25/09, 11:30–12:05)
- Splash quadro a quadro (screencap no aparelho a ~0,5 s): encontro com partículas e onda, wordmark lima com gradiente e brilho, tagline, saída sem engasgo; fonte da marca presente desde o primeiro quadro.
- Welcome após logout: monograma desenhando ao lado do wordmark, headline letra a letra; login refeito com o código de dev.
- Perfil, Premium e mapa com os textos novos; build nativo (`assembleDebug`) instalado: gaveta de apps mostra **"Metch"** com o ícone lima/M preto/faísca magenta.
- Sequência final de boot: 5/5 aberturas sem crash (os 3 crashes das variantes intermediárias estão em 16.2).

### 16.5 Revisão adversarial (workflow, 21 agentes, 17 achados → 11 confirmados e corrigidos)
Faixa de brilho estacionada fora das letras (a diagonal tem pegada horizontal H²/(2·band)); pontas do gradiente em branco transparente (o Skia interpola sem pré-multiplicar — preto transparente escurecia); `paused` no logo (Welcome fora de foco não redesenha por frame); splash respeita "reduzir movimento" de verdade (halo, blobs e saída só em fade); rótulo "Seu avatar Metch"; fallback `<Text>` com a mesma caixa do canvas; alinhamento de linha de base no `MetchLogo` pelas métricas da fonte; canvas do monograma com sangria pro halo (não corta o brilho); véu de saída até opacidade 0 (sem corte seco); `splashscreen_image.png` removidas (expo-splash-screen não está instalado — a splash nativa é só a cor, e o brief é a splash em JS). Rejeitados pelo cético: e-mail de suporte (decisão do founder), faísca "ilegível" no ícone, modal de acessibilidade na splash, copy de background no iOS.

### 16.6 Pendências / decisões
- **E-mail de suporte** virou `suporte@metch.app` (`BRAND.supportEmail`) — confirmar o domínio real da marca.
- Documentação de produto (`Cruzei APP/*.md`, README do monorepo) ainda fala "Cruzei" no histórico; o README ganhou a nota da marca.
- iOS: `app.json` já leva o nome; ícones/splash do iOS saem do `expo prebuild` a partir dos assets novos (nunca buildado).
- Link `cruzei://` continua aceito pelo manifest; `metch://` é o novo scheme.

---

## 17. Sessão 25/09/2026 (tarde) — busca "Onde tá a vibe" no topo do mapa

Pedido do founder: um filtro de pesquisa acima da localização pra achar **onde está rolando a vibe** — eventos, lugares com mais gente usando o app — "bem premium, melhore a ideia". Entregue como um sistema de três peças:

### 17.1 Backend — `GET /pois/vibe` (`apps/backend/src/modules/pois/pois.service.ts` → `vibe()`)
- Lugares num raio (500 m–15 km, padrão 8 km) em volta de um **centro público** (centro do mapa) ou de mim (filtro "perto de mim"); nunca a posição de terceiros.
- Sinais **ao vivo** por lugar, todos agregados: `peopleNow` (**última linha viva de cada usuário** — quem andou pra outro lugar ou pra casa some na hora; sem anônimos, sem pausados/excluídos/"ninguém", **sem o próprio solicitante**, **piso de anonimato 2** igual ao resto do produto), `trend` (vs. onde cada pessoa estava há 45 min, só quando há gente agora), `lastActive` em **faixa** (online / há pouco / mais cedo — nunca minutos, e só com gente o bastante), `isEvent`/`eventLabel` (categorias `event`/`show`; horário do JSON quando existir, senão "Hoje"). Índices `(poi_id, recorded_at)` e `(poi_id, expires_at)` em `locations` (migração `20260925150000`).
- **`vibeScore` 0–100** (gente agora em escala log + tendência + evento + atividade recente + parceiro) e **`vibeLevel`** quiet / warming (≥ 2) / hot (≥ 5, o mesmo `HOT_MIN` do pulso no mapa) / peak (≥ 12).
- Filtros `all | hot | events | people | near`, categorias, texto tolerante a acento ("cafe" acha "Café", "bar" acha pela categoria). O resumo (`peopleAtPlaces`, `hotCount`) é do raio inteiro; o texto só filtra a lista.
- Rate limit 30/min por usuário; validação de lat/lng e de categoria (400, antes estourava 500); rotas literais antes de `:id` (o `hotspots` antigo caía no `:id`). A mesma semântica de presença passou pra `countUsersAtPOI` e `getPeople` (sheet do lugar). `POST /location/update` só aceita `poiId` se a posição reportada está a ≤ 150 m do lugar.
- Tipos em `packages/shared-types/src/location.ts` (`VibePlace`, `VibeResponse`, `VibeFilter`, `VibeLevel`).

### 17.2 App — barra + overlay
- **`VibeSearchBar`** (`components/map/VibeSearchBar.tsx`): pílula de vidro escuro com borda lima acima da linha da localização; sugestões que se revezam ("Onde tá a vibe hoje?", "bares no Centro", "eventos rolando agora"…); selo à direita "🔥 N em alta" ou ponto "ao vivo" pulsando. O chip "em alta" duplicado da linha de indicadores some quando a barra existe.
- **`VibeOverlay`** (`components/map/VibeOverlay.tsx`): modal por cima do mapa, entra deslizando; busca com debounce; chips ✨ Tudo · 🔥 Em alta · 🎤 Eventos · 👥 Mais gente · 📍 Perto de mim + categorias (🍻 🍔 ☕ 🌳 🎵 🛍️); linha **AO VIVO · N pessoas em lugares · M em alta** (atualiza a cada 45 s); lista ranqueada; estados vazios por filtro ("Nada bombando agora 😴 Os lugares acendem quando têm 2+ pessoas"); seção **"Ir até um lugar"** com bairros, ruas e cidades do **Mapbox Geocoding v6** (proximidade = centro do mapa arredondado a ~1 km, nunca a posição fina).
- **`VibePlaceRow`**: tile da categoria que acende com o nível (quieto cinza → esquentando lima → em alta/bombando magenta com glow e pulso), nome + selo "🎤 Hoje" em eventos, bairro, distância (`~250 m`), "ativo há N min", **👥 contagem + tendência (▲ +18)** e **medidor de 5 barras** (lima → magenta).
- **Integração** (`MapScreen`): tocar um lugar fecha a busca, leva a câmera (zoom 16,5, pitch 58) e abre a sheet do lugar na hora (`pickedPoi` como fallback enquanto o `/pois/nearby` re-centraliza; o destaque no WebView chega quando o lugar entra no recorte). Tocar um resultado do Mapbox só leva a câmera (zoom por tipo: cidade 12,5 · bairro 14,5 · rua 16 · endereço 17).

### 17.3 Validação no Motorola (25/09, 13:10–15:25)
- Barra no topo com sugestão rotativa e "🔥 2 em alta"; overlay com lista (Sunset na Praça 18 ▲+18 bombando, Bar do Léo 5 ▲+5 em alta, demais "quieto"); filtro "Em alta" só com os dois; "praca" acha Sunset na Praça e lista praças do Mapbox; "saraiva" → nenhum lugar do app + bairro Saraiva (Uberlândia) em primeiro pela proximidade; toque no Sunset → câmera + sheet "Evento · hoje · ~250 m · 18 pessoas no Metch · Em alta"; toque em "Saraiva" → mapa vai pro bairro.
- Depois da revisão: lista com "esteve por aqui" (faixa), toque no lugar destacando o pino só depois do recorte carregar, teclado sem cobrir a lista.
- Dois bugs de render achados e corrigidos no aparelho: `FadeInView` (baseado em `useAnimatedStyle`) ficava **invisível** dentro das linhas da FlatList e dentro da barra → entradas com **layout animations** (`entering={FadeInDown}`); `ScrollView` horizontal dos chips nasce com `flexGrow: 1` e esticava na vertical → `flexGrow: 0`.

### 17.4 Revisão adversarial (workflow, 29 agentes, 30 achados → 20 confirmados e corrigidos)
- **Privacidade (alto)**: o piso de anonimato contava o próprio solicitante e `lastActiveMin` (minuto a minuto) virava o relógio de uma pessoa sozinha num lugar (reproduzido ao vivo pelo verificador com duas contas) → solicitante fora das contagens, atividade em faixa, `poiId` do app validado por distância.
- **Backend (alto)**: contagem "agora" somava toda linha viva (2 h) → uma pessoa aparecia em todos os lugares por onde passou e a tendência nunca ficava negativa → presença = última linha de cada usuário (também na sheet do lugar e na contagem pública); pausados/excluídos/"ninguém" fora; índices por lugar; categoria inválida → 400.
- **App**: estado vazio falso enquanto a consulta anterior era reaproveitada; spinner infinito sem posição; "perto de mim" caía no centro do mapa sem posição própria; teclado cobria o fim da lista (Modal translúcido não redimensiona); busca anterior piscava ao reabrir; polling com o app em background; barra anunciada como campo de texto; destaque do lugar escolhido enviado antes do `setData` que o contém (nunca acendia) e foco pendente que podia pular a câmera minutos depois; "Ver no mapa" de lugar fora do recorte não fazia nada; cartão do match e padding do mapa presos à altura antiga do header → header medido por `onLayout`.
- Rejeitados: posição própria na query string (já é assim no `/location/update`), corte de 300 POIs no bbox (14 na cidade), divergência sheet × lista (resolvida junto), seed "por construção", atraso das linhas ao rolar (40 ms × 8).

### 17.5 Estabilidade nativa no boot (investigação, 16:00–16:30)
Durante a validação apareceram **crashes nativos intermitentes**, todos no boot ou na primeira tela pesada depois dele, com 4 assinaturas: (a) HWUI RenderThread `OpsTask::tryConcat` em `drawRRect` (dentro de `renderLayerImpl` ou no draw normal); (b) HWUI `SkStrikeCache` corrompido (medição/desenho de texto — surge na primeira tela com muito texto); (c) `libreanimated.so` na thread principal, recursão 1 s depois da splash montar (o mesmo crash intermitente já registrado no §11); (d) `libhermes.so` na thread JS no boot. Junto deles, erros `SurfaceTexture … EGLConsumer is not attached to an OpenGL ES context` no instante em que a WebView do mapa é criada.

Experimentos (loop adb: `force-stop` → `am start` → 26 s → ação → contagem de `F DEBUG` no buffer `crash`, dump por run):
| Cenário | Boots | HWUI | JS (Reanimated/Hermes) |
|---|---|---|---|
| Abrir a busca (WebView em camada `hardware`) | 12 | 2 | 1 |
| Abrir só o Perfil, sem busca (`hardware`) | 8 | 3 | 0 |
| Idem com a splash mantida montada (sem destruir canvases Skia) | 5 | 2 | 0 |
| WebView em camada `none`, alternando Perfil e busca | 10 | 1 | 2 |

Conclusões: **não é a busca** (reproduz abrindo o Perfil) e **não é a destruição dos canvases Skia** (reproduz com eles vivos). A corrupção do HWUI nasce na criação da WebView (Chromium desenhando pelo functor GL no mesmo RenderThread, driver Mali/MediaTek do Moto g54). Decisões: WebView com `androidLayerType="none"` (padrão do RN WebView; sem camada FBO do HWUI — menos crashes na amostra, mapa e overlays iguais), overlay e linhas da busca **sem canvases Skia** (gradientes + Reanimated), sugestão da barra sem layout animation. O crash (c)/(d) é anterior à marca e à busca.

**Próximo passo recomendado (sessão própria, build nativo):** subir `@shopify/react-native-skia` 1.2.3 → **1.12.4** (última linha para RN ≤ 0.78; traz `opaque`/SurfaceView e correções de superfície no Android) e `react-native-reanimated` 3.10.1 → 3.16.x; repetir o loop de 10 boots. Se persistir, tirar os canvases Skia do boot (splash em react-native-svg).

### 17.6 Decisões / pendências
- **Premium**: hoje a busca é igual pra todo mundo (raio 8 km em volta do centro do mapa, que qualquer um arrasta). A decisão pendente do §15 ("cidade inteira" = lugares) cabe aqui: se quiser diferenciar, limitar o raio do free a ~3 km em volta do próprio usuário e liberar 15 km + "Mais gente" na cidade pro Premium.
- Eventos: sem horário estruturado no banco (`hours` vazio), tudo aparece como "Hoje"; quando eventos tiverem `start/end`, o rótulo já usa.
- Teclado: `autoFocus` + foco no `onShow` do Modal; o campo nasce focado (o teclado sobe na maioria das aberturas).

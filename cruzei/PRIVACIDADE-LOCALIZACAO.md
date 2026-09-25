# Privacidade de localização, anti-triangulação e descoberta segura — entrega

Brief: `Cruzei APP/PRIVACIDADE/Privacidade cruzei.md`. Data: 24–25/09/2026.

Princípio implementado: **o Cruzei não mostra onde uma pessoa está; mostra quem está disponível para interagir perto de você.**

## 1. Arquivos modificados

Backend (`apps/backend`)
- `src/modules/location/location.service.ts` — reescrito: `discover()` (descoberta por proximidade), `discoverability()` (cartão/acenos), `discoverableAtPlace()` (quem está no lugar), `update()` com intervalo mínimo, áreas privadas, aprendizado de residência, histórico grosseiro.
- `src/modules/location/location.controller.ts` — `/nearby` ignora centro/raio do cliente; throttles.
- `src/redis/redis.service.ts` — presença com `hidden` e `cell`, TTL 2 h.
- `src/modules/users/users.controller.ts`, `users.service.ts` — `discoveryMode` nas configurações; CRUD de áreas privadas.
- `src/modules/users/public-users.controller.ts` — cartão sem distância/coordenada; faixa só enquanto descoberto; 404 uniforme.
- `src/modules/pois/pois.service.ts`, `pois.controller.ts`, `pois.module.ts` — "quem está aqui" só para quem pode descobrir e está perto; contagens com piso de anonimato e sem anônimos.
- `src/modules/waves/waves.service.ts`, `waves.module.ts` — aceno só para quem é descoberto (350 m, reciprocidade, bloqueio).
- `src/modules/matches/match-context.service.ts` — contexto do match sem metros ("bem perto"/"perto").
- `src/tasks/matches-cleanup.task.ts` — retenção do histórico de 7 dias → 3 dias (configurável).
- `src/app.module.ts` — rate limit por usuário (`UserThrottlerGuard`).
- `prisma/schema.prisma` — `users.discovery_mode`, tabela `private_areas`.

App (`apps/mobile`)
- `src/screens/map/MapScreen.tsx` — `/nearby` sem centro; faixas em vez de distância; marcador só com `mapPosition`; pessoas no lugar só pela presença do servidor; contagem de ocultos; banner de área privada.
- `src/screens/map/mapbox-html.ts`, `bridge.ts` — WebView só recebe `mapPosition` (posição visual).
- `src/components/map/MapBottomSheet.tsx`, `PersonRow.tsx`, `UserPreviewSheet.tsx`, `MapHeader.tsx`, `src/components/MatchModal.tsx`, `src/hooks/useDiscoveryHints.ts`, `src/screens/likes/LikesScreen.tsx`, `src/screens/users/UserCardScreen.tsx`, `src/navigation/RootNavigator.tsx` — faixas, presença sem horário.
- `src/screens/profile/ProfileScreen.tsx` — seletor "Descoberta por proximidade" e link "Áreas privadas".
- `src/services/location.ts`, `src/stores/location.ts` — resposta do update alimenta o estado "estou descoberto?"; função de permissão de background removida.
- `app.json`, `android/app/src/main/AndroidManifest.xml` — `ACCESS_BACKGROUND_LOCATION` removida.

Pacotes
- `packages/shared-types/src/location.ts` — DTO seguro (`NearbyUser`, `DiscoveryResponse`, `ProximityBand`, `PresenceType`, `LastSeen`, `MapPosition`, `PrivateArea`, `HiddenReason`); `user.ts` — `DiscoveryMode`.
- `packages/shared-utils/src/geo/proximity.ts` — rótulos/ordem das faixas.

## 2. Arquivos novos
- `apps/backend/src/modules/location/discovery-privacy.ts` — regras e limites (todos por variável de ambiente), faixas, células, anonimização, residência, varredura de chaves proibidas.
- `apps/backend/src/common/guards/user-throttler.guard.ts` — rate limit por token/usuário.
- `apps/backend/prisma/migrations/20260925100000_privacy_discovery/migration.sql`.
- `apps/backend/test/privacy-audit.ts` — os 10 testes de segurança do brief (17 asserções).
- `apps/mobile/src/screens/profile/PrivateAreasScreen.tsx` — cadastro de áreas privadas.

## 3. Arquitetura antiga vs. nova

| Ponto | Antes | Agora |
|---|---|---|
| Centro da busca | lat/lng enviados pelo cliente (dava para varrer a cidade arrastando o mapa ou forjando parâmetros) | **sempre a posição do próprio usuário no servidor**; parâmetros do cliente são ignorados para pessoas (lugares, públicos, seguem o mapa) |
| Raio | 300–5000 m (premium/boost via cliente) | **≤ 350 m**, fixo no servidor (`DISCOVERY_RADIUS_M`) |
| O que sai sobre terceiros | `latitude/longitude` "borrados" (real + jitter fixo do dia = acompanha a pessoa), `distanceM` em degraus, `recordedAt` preciso | **faixa** (`very_near/near/region`), **tipo de presença** (lugar/por perto), **posição visual** (centro de célula ou ponto do lugar) ou nada, `lastSeen` (online/recente/mais cedo) |
| Cartão público `/users/:id` | distância em degraus + lugar de qualquer usuário visível da cidade | faixa e lugar **só enquanto a pessoa é descoberta por quem consulta** (≤ 350 m, reciprocidade, bloqueio, área privada); senão `null`; 404 idêntico para inexistente/anônimo/bloqueado |
| Quem está no lugar (`/pois/:id/people`) | qualquer lugar da cidade, sem bloqueio, sem piso | só quem pode ser descoberto por mim, só se eu estou a ≤ 350 m do lugar e o lugar tem ≥ K pessoas; anônimos fora das contagens |
| Acenos | ≤ 5 km | só para quem eu descubro agora |
| Presença (Redis) | TTL 5 h | TTL 2 h; flag `hidden` (área privada/residência) |
| Histórico (Postgres) | coordenada precisa, 7 dias após expirar | coordenada **grosseira (3 casas ≈ 110 m)**, 3 dias após expirar; anônimo/oculto marcado |
| Rate limit | global 600/min por IP | por **usuário** (token): `/nearby` 20/min, `/location/update` 12/min (+ intervalo mínimo de 20 s aceito), `/users/:id` 60/min, `/pois/:id/people` 30/min |
| Descoberta | todos veem todos os visíveis | **recíproca**: Todos / Interesses compatíveis / Ninguém — vale para os dois lados |
| Residência | nada | áreas privadas manuais + aprendizado automático de residência (madrugadas) → oculto |
| Background location | permissão declarada (sem uso) | removida; só primeiro plano |

## 4. Raio de 350 m
`discover()` lê a presença real do solicitante no Redis, busca candidatos nas células geohash-5 vizinhas, calcula a distância real servidor-a-servidor e descarta quem passa de `DISCOVERY_RADIUS_M` (350). O cliente manda no máximo `radius_meters` (clampado a 350) e nunca o centro. O número nunca sai: só a faixa.

## 5. Anonimização
- **Faixas**: ≤ 100 m "bem perto", ≤ 250 m "perto", ≤ 350 m "na região". Calculadas da posição real de quem consulta contra a **posição visual** da pessoa (não a real) — consultar de vários pontos só reconstrói a posição visual.
- **Posição visual** (`mapPosition`): se a pessoa está num lugar (POI) com ≥ `DISCOVERY_MIN_PLACE_K` (2) pessoas → ponto do lugar + 8–25 m; senão → **centro da célula geohash-7 (~153 m)** + deslocamento diário determinístico de até 35 m. Andar dentro da célula não move o pin.
- **Mínimo de anonimato**: se a área geohash-6 (~1,2 km × 0,6 km) da pessoa tem menos de `DISCOVERY_MIN_AREA_K` (2) pessoas visíveis, ela **não recebe identidade nem marcador** — entra só em `hiddenCount` ("+N por perto").
- Anônimo, pausado, "Ninguém" e área privada nunca entram na descoberta.

## 6. Anti-triangulação
- Posição visual por célula (estável enquanto a pessoa fica na célula; muda no máximo 1× por dia dentro dela); faixa derivada dessa mesma posição.
- Intervalo mínimo de 20 s entre atualizações de posição aceitas (as demais devolvem o último resultado) + throttle 12/min.
- `/nearby` 20/min por usuário; sem timestamps precisos (`lastSeen` em três níveis); sem direção, velocidade, rota, posição anterior — nenhum desses campos existe no DTO. O mapa continua interpolando o **movimento visual** entre posições visuais (célula → célula), nunca a trilha real.
- Teste 4: 4 posições reais a 30 m produziram 2 posições visuais (uma troca de célula).

## 7. Proteção residencial / locais sensíveis
- **Manual**: `POST/GET/DELETE /me/private-areas` (até 5 áreas, raio 50–1000 m); tela "Áreas privadas" no Perfil (adiciona a posição atual com rótulo Casa/Trabalho/Faculdade/Outro e raio). A coordenada fica só no servidor; a lista devolve rótulo e raio.
- **Automática**: a cada atualização entre 00h e 06h (Brasília) o servidor guarda só a célula geohash-7 do dia; ≥ 3 noites na mesma célula → célula (e vizinhas) viram área de residência por 45 dias.
- Dentro de qualquer uma: presença marcada `hidden` → a pessoa vê os outros, ninguém a vê; `POST /location/update` responde `discoverable:false, hiddenReason:'private_area'|'home'` e o header do mapa avisa "🏠 Área privada: ninguém te vê aqui".

## 8. Rate limiting / anti-scraping
`UserThrottlerGuard` (global) usa o hash do bearer token como chave (IP só sem token). Limites por rota acima. Enumeração: ids são UUID v4; `/users/:id` responde o mesmo 404 para inexistente, anônimo, pausado e bloqueado; varredura de regiões é impossível porque o centro não é do cliente. O que ainda é possível está em §14.

## 9. Dados que deixaram de ir ao cliente
`latitude`, `longitude`, `distanceM` e `recordedAt` de terceiros (em `/nearby`, `/users/:id`, deck de curtidas, modal de match, contexto do match em metros), `distanceM` do cartão, lugar/distância de quem não está descoberto, nomes em lugares distantes ou com poucas pessoas, contagens de lugar com 1 pessoa, presença de anônimos nas contagens.

## 10. Mapbox
O WebView recebe só `mapPosition` (posição visual) por pessoa; `setData` descarta quem não tem. Movimento, seleção, momento do match e efeitos usam essa posição. Nenhum `u.latitude/u.longitude` restou no HTML gerado. Lugares e eventos (públicos) continuam com coordenada.

## 11. Realtime / WebSocket
Auditado `realtime/chat.gateway.ts` e todos os `emitToUser`: `like_received {fromUserId,isSuper}`, `match_created`, `message_read`, `typing_indicator`, `wave_received {fromUserId,name,avatar,at}` — nenhum payload com coordenada, distância ou lugar. Teste 9 confirma com um cliente socket.io real.

## 12. Anônimo / invisível preservados
Modo anônimo continua: fora do `/nearby`, do cartão, dos lugares e das contagens; a pessoa vê os outros. "Ninguém" (novo) é recíproco: não aparece **e não vê**. Pausado continua fora de tudo.

## 13. Resultado dos testes (`pnpm exec ts-node test/privacy-audit.ts`, backend dev ligado, 25/09/2026)
17/17 PASS — 1 API sem chaves proibidas (35 pessoas, 0 posições coincidindo com a real); 2 cartão só faixa, 404 uniforme, `/location/me` só meu; 3 rate limit (21× 429 em 40) e por usuário (outra conta 200); 4 anti-triangulação (4 posições reais → 2 visuais); 5 bloqueio corta os dois sentidos + cartão 404; 6 área privada esconde (hiddenReason=private_area) e lista sem coordenada; 7 região esparsa vira `hiddenCount=1`; 8 centro/raio do cliente ignorados (radiusM=350), lugar distante sem nomes, 2ª atualização em < 20 s ignorada; 9 WebSocket sem coordenada; 10 app sem persistência de descoberta.
Testes unitários do app: `formatMapName` (7). Type-check: backend e app sem erros.

## 14. Vulnerabilidades restantes (honestas)
- **Célula ≈ 150 m dentro do raio de 350 m**: quem está fisicamente a ≤ 350 m de você sabe em que célula você está (é o produto). A residência protege casa; a área esparsa protege quem está sozinho na região; fora disso a célula é a resolução final.
- **Aprendizado de residência precisa de 3 noites**: nos primeiros dias a pessoa é protegida só se cadastrar a área manualmente (a tela existe; sugerir no onboarding é decisão de produto).
- **Presença em lugar**: "Fulano está no Bar do Léo" é informação de localização por escolha do produto (§10); exige ≥ 2 pessoas no lugar e o observador a ≤ 350 m.
- **Histórico grosseiro por 3 dias** no Postgres (contexto do match / "se cruzaram no lugar"): ~110 m, sem acesso por API; acesso ao banco = acesso ao histórico grosseiro.
- **Redis com posição real** (TTL 2 h) e **áreas privadas com coordenada** no Postgres: necessários ao cálculo; sem endpoint que os devolva; proteger o acesso à infraestrutura.
- **Cliente moderno + paciência**: um observador que se move e reconsulta ainda aprende trocas de célula (150 m) de quem está a ≤ 350 m dele — mitigado por 20/min, faixas e posição por célula; não eliminado.
- Contadores de lugar (`userCount`) com piso 2: com exatamente 2 pessoas, quem é uma delas sabe que há outra.
- Rate limit em memória por instância: em produção com várias réplicas, usar storage Redis do `@nestjs/throttler`.

## 15. Decisões manuais necessárias
- **Premium "ver a cidade inteira"**: a descoberta individual é 350 m para todos (segurança > plano). O que o Premium pode ver longe são **lugares em alta e contagens**, não pessoas. O texto do paywall/CTA precisa ser ajustado pelo produto.
- Valores dos limites (`DISCOVERY_MIN_AREA_K=2`, `DISCOVERY_MIN_PLACE_K=2`, `DISCOVERY_RADIUS_M=350`, TTL 2 h, retenção 3 d) são variáveis de ambiente — calibrar com dados reais.
- Sugerir "Área privada: casa" no onboarding.
- Em produção: `LOCATION_SALT` forte, storage Redis para o throttler, e alerta/bloqueio para contas com 429 recorrentes (o guard só limita).

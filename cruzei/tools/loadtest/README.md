# Teste de carga agressivo — 1.000 pessoas num raio de 300 m

Simula muita gente usando o Metch ao mesmo tempo em volta de um ponto, pra medir o **servidor** (latência, erros,
CPU/memória do backend, Postgres e Redis) e o **celular** (mapa com centenas de avatares no pior caso) juntos.

| arquivo | o que faz |
|---|---|
| `seed.js` | cria/atualiza N contas falsas `+5534911xxxxxx` com presença ativa num raio em volta da coordenada |
| `run.js` | "abre o app" nas N contas: socket.io aberto + posição, nearby, perfis, acenos, curtidas e chat; painel a cada 10 s e relatório no fim |
| `monitor.js` | CPU/memória de todos os processos do backend (primário + workers do cluster) e `docker stats` do Postgres e do Redis a cada 5 s |
| `cleanup.js` | tira a presença das contas do teste; com `--delete` apaga as contas |
| `lib.js` | base comum (args, ambiente do backend, faixa de telefones) |

Tudo roda com o Node da máquina, da raiz do monorepo (`cruzei/`), sem instalar nada: os pacotes (`@prisma/client`,
`ioredis`, `socket.io-client`, `@nestjs/jwt`, `@cruzei/shared-utils`) já estão no `node_modules` do monorepo.
Relatórios e amostras vão pra `tools/loadtest/out/` (fora do git).

## Antes de começar

- Backend de **desenvolvimento** rodando (`NODE_ENV=development`) e compilado (`apps/backend/dist` existe — o servidor
  de dev já roda dele). Os scripts recusam rodar fora de dev ou com banco de produção (mesma trava do `seed-dev`).
- Docker com `cruzei-postgres` e `cruzei-redis` de pé.
- Os scripts carregam os `.env` do backend pelo **próprio código da aplicação** (`dist/src/config/load-env`), igual ao
  `main.ts`. Nada de `.env` é lido à mão nem impresso.
- Celular: a conta do aparelho precisa estar a menos de 350 m da coordenada do teste (use o lugar onde o celular está)
  e o túnel `adb reverse tcp:3000 tcp:3000` ligado (as fotos falsas apontam pra `http://127.0.0.1:3000/uploads/fakes/`;
  na LAN, rode o seed com `PUBLIC_BASE_URL=http://<ip>:3000`).

## Comandos (1.000 pessoas)

```bash
# 1. semear (segundos; pode repetir: atualiza as mesmas contas)
node tools/loadtest/seed.js --n 1000 --lat -18.924 --lng -48.271 --radius 300

# 2. monitor, num terminal separado (Ctrl+C pra parar e ver o resumo)
node tools/loadtest/monitor.js

# 3. carga: 10 min, subindo as 1.000 pessoas nos primeiros 2 min
node tools/loadtest/run.js --n 1000 --duration 600 --ramp 120 --lat -18.924 --lng -48.271

# 4. limpar: some do mapa (as contas ficam pra próxima)…
node tools/loadtest/cleanup.js
#    …ou apaga as contas de vez (conversas, curtidas, acenos e fotos saem em cascata)
node tools/loadtest/cleanup.js --delete
```

Entre testes separados por mais de 2 h a presença venceu: renove sem mexer nas contas com
`node tools/loadtest/seed.js --refresh --n 1000 --lat -18.924 --lng -48.271 --radius 300`
(cada pessoa volta pro mesmo ponto). Durante o `run.js` não precisa: cada posição aceita renova a presença.

## Login (como foi resolvido)

1.000 logins pelo caminho do app (`request-code` → `devCode` → `login`) de um IP só esbarram nos limites de SMS e no
throttler por IP. Então o `run.js` **assina o token em processo**: carrega a config do backend do mesmo jeito que a
aplicação (`load-env` + `configuration().jwt.secret`) e assina com o `JwtService` do `@nestjs/jwt` o mesmo payload do
`AuthService.issueTokens` (`{ sub, phone, typ: 'access' }`), com validade = duração do teste + 15 min. O servidor
valida normalmente (JwtStrategy, estado da conta, socket). Como o rate limit do servidor é por conta quando o token é
válido (`UserThrottlerGuard`), cada pessoa virtual tem a sua cota, como um celular de verdade. Nenhum token é impresso
nem gravado. **Não precisa passar variável nenhuma ao servidor.**

Se o servidor subiu com um `JWT_SECRET` diferente do `.env` (passado na linha de comando), o `run.js` para logo no
início com "401 no /me". O fluxo de login por SMS em si não é medido por este teste.

## O que cada pessoa virtual faz

| comportamento | quem | intervalo médio por pessoa (cada espera sorteia 0,5×–1,5×) | rota |
|---|---|---|---|
| anda 0–15 m (sem sair do raio) e manda a posição | todos | `--rate-loc 10` → 5–15 s | `POST /location/update` |
| olha quem está perto | `--share-nearby 0.6` (+ quem abre perfil/interage) | `--rate-nearby 45` | `GET /location/nearby?radius_meters=350` |
| abre um perfil de quem viu no nearby | `--share-profile 0.4` | `--rate-profile 40` | `GET /users/:id` |
| aceno 45% / curtida 40% / super curtida 15% em quem viu | `--share-social 0.3` | `--rate-social 60` | `POST /waves`, `/likes`, `/likes/super` |
| conversa em pares fixos (digitando + mensagem; responde 60% das vezes ao receber) | `--share-chat 0.2` | `--rate-chat 40` | `POST /conversations`, `/conversations/:id/messages`, socket `join_conversation`/`typing` |
| socket.io aberto como o app (`transports: ['websocket']`, reconexão 1–30 s) + `heartbeat` a cada 30 s | todos | | socket `/` |

Ao entrar, cada pessoa chama `GET /me` (conta como o "login ok") e manda a primeira posição. Outros parâmetros:
`--n`, `--duration` (s, total, já com a subida), `--ramp` (s de subida gradual), `--lat`, `--lng`, `--radius`,
`--api http://127.0.0.1:3000/v1`, `--ws http://127.0.0.1:3000`, `--timeout 20` (s por requisição), `--panel 10` (s).

### O seed (pior caso de avatar, pedido do dono do app)

Todas as contas são `premium_plus` (os itens plus valem) e ganham, validado com `normalizeAvatarConfig` do
`@cruzei/shared-utils` (o seed diz quantos itens o normalize recusaria — deve ser 0):

- roupa por cima (cape, mantle, trench, kimono, puffer, mecha) sobre top elaborado (gown, sequin, armor, royal, holo);
- asas ou jetpack nas costas; cabelo volumoso (afro, long_curly, braids, dreads, braid_crown);
- chapéu, óculos, brinco, colar e pulso; sapato e calça "especiais"; objeto na mão em 60%;
- aura animada em todos com `auraLevel: 'max'`; fundo (backdrop) e animação assinatura (emote) em todos;
- pet (dragon, phoenix, unicorn…) em ~75%, veículo em ~55%, orgulho em ~40%, pronomes em ~45%.

Perfis variados (gênero 45/45/10, idade 18–59 puxada pros 20 e poucos, `show_me` 70% todos / 15% mulheres / 15%
homens, orientação, 3–6 interesses, 75% com foto falsa — `--photo-share` muda), todos visíveis, descobríveis, com os
termos aceitos (`terms_version` atual). A presença é gravada pelo próprio `RedisService` do backend (o mesmo script
Lua do `/location/update`: `user:loc:<id>` + ZSET `presence:<geohash6>`) com o TTL do app
(`PRIVACY.PRESENCE_TTL_S`, 2 h por padrão), em pontos uniformes no disco de raio `--radius`.

## Saídas

- **Painel a cada 10 s**: pessoas ativas, sockets conectados, reconexões, erros de socket, eventos recebidos/s,
  heartbeat p95, requisições em voo, atraso do loop do cliente e, por rota, req/s, p50/p95/p99 (ms) e 2xx/4xx/5xx/rede.
- **Relatório** `out/run-<data>.json` e `.md`: totais por rota (p50/p95/p99/máx, códigos), logins, sockets (conexões,
  quedas por motivo, erros, eventos por nome), pessoas por resposta do nearby, amostras dos erros e a linha do tempo
  janela a janela (pra cruzar com o monitor).
- **Monitor** `out/monitor-<data>.jsonl`: uma linha por amostra (CPU em % de **um** núcleo e RAM por processo do backend,
  CPU/RAM/PIDs/rede/disco de cada contêiner) e o resumo (média/máx) na última linha.

Como ler: `429` em `/likes/super` ou `/conversations` é cota do dia (super curtida 7/dia; 30 conversas novas/dia),
não falha. `503` no nearby = fila da descoberta cheia (`DISCOVERY_MAX_CONCURRENCY`/`DISCOVERY_MAX_QUEUE`), ou seja,
sobrecarga. `5xx` restante, `rede` e `timeout` são problema de verdade.

## Resultado do teste pequeno (06/10/2026, 50 pessoas, 60 s, -18.924 -48.271)

50/50 logins, 50/50 sockets conectados o tempo todo (0 reconexões, 0 erros), nearby devolvendo 40 pessoas por
resposta em média (as 50 + os fakes do seed-dev na região), **nenhum 4xx/5xx** em 441 requisições. p50/p95:
`/location/update` 22/124 ms, `/location/nearby` 28/112 ms, `/users/:id` 29/87 ms, mensagens 41/214 ms. Backend
≤ 8% de um núcleo, Postgres ≤ 5%, Redis ≤ 1,2%. Uma rodada extra só de interação (todas as 50 acenando/curtindo a cada
6 s) teve 133 curtidas, 51 super curtidas, 120 acenos, 149 mensagens e 6 eventos `match:new`, tudo 2xx.

## Limites conhecidos

- **Gerador num processo só.** 1.000 pessoas cabem com folga (≈150 req/s + 1.000 sockets); acima de ~3.000 sockets o
  Windows aperta. Se o "loop do cliente p99" passar de ~100 ms, o gargalo é o gerador e as latências ficam infladas
  (no Windows o piso é 16–35 ms pela granularidade do timer — normal).
- **Cluster no Windows concentra num worker.** No teste quase toda a CPU caiu num worker só: o Node no Windows usa
  `SCHED_NONE` (o sistema escolhe quem aceita a conexão) e todas as conexões vêm de 127.0.0.1. Pra distribuir na carga
  de 1.000, suba o servidor com a variável do próprio Node `NODE_CLUSTER_SCHED_POLICY=rr` (opcional; sem ela o
  resultado mostra o pior caso de um worker). O app e o painel usam só websocket, então o `rr` sem sessão
  fixa não quebra o socket.
- **Posição: o servidor aceita 1 a cada 20 s por pessoa** (`MIN_UPDATE_INTERVAL_S`). Os envios a cada 5–15 s são
  respondidos pelo cache (`loc:last`), como acontece com o app; só ~metade vira escrita de presença.
- **O celular vê no máximo 300 por resposta** (`DISCOVERY_MAX_USERS`, com rotação justa). Pra forçar mais gente no
  mapa, o coordenador pode subir o servidor com `DISCOVERY_MAX_USERS=1000`.
- **Cotas do dia acumulam entre execuções**: super curtidas (cada pessoa manda no máximo 5 por execução; a 2ª execução
  no mesmo dia já pode dar 429), curtidas repetidas e acenos repetidos (voltam `duplicate`). Os pares de conversa são
  fixos pra reaproveitar as mesmas conversas e não gastar o teto de conversas novas.
- **Dados acumulam**: curtidas, matches, conversas, mensagens e notificações das contas do teste ficam no banco até um
  `cleanup.js --delete`.
- **Madrugada**: o servidor aprende "casa" com 3 noites (00–06 h) na mesma célula e esconde a pessoa ali. O `seed.js` e
  o `cleanup.js` apagam a casa aprendida das contas do teste.
- **Monitor do backend só no Windows** (PowerShell; acha o processo que escuta `--port` e os filhos dele). O
  `docker stats` funciona em qualquer sistema.
- O avatar pesado só pesa no **celular** (renderização); pro servidor ele é só um JSON maior no nearby.

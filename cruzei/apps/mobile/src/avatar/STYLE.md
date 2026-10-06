# Avatar Metch — guia de estilo (diretor de arte)

Este guia vale pra **todo mundo que desenha partes do avatar**: roupas, cabelo, chapéus, orgulho, veículos, pets e
objetos. A fonte da verdade é o código:

- `anatomy.ts`: medidas, proporção, juntas, repouso de cada pessoa, rosto adulto, pé 3D e contornos;
- `shading.ts`: volume, materiais e nível de detalhe;
- `parts/body.ts` e `parts/face.ts`: corpo e rosto de referência;
- os provisórios de `parts/clothes.ts` (camiseta, jeans, tênis) e `parts/hair.ts` (curto, longo, cacheado, black
  power): servem de **exemplo de método**.

Confira tudo na folha de contato (`scripts/avatar-sheet.ts`) e **abra o PNG**. Compilar não basta.

## 1. Direção de arte

- **Gente adulta de verdade, estilizada.** Vetorial pintado, semi-realista, acabamento de jogo social mobile premium.
  Não é boneco geométrico, não é criança, não é foto.
- **Proporção: ~5,5 cabeças** (5,45–5,6 entre os tipos de corpo; rosto longo ~5,2). A cabeça mede ≈ 22 do topo do
  crânio ao queixo (`HEAD_SCALE` 0,92, que acompanha um pouco a estatura: `× k^0,7`). Os **olhos ficam na metade da
  cabeça**; o terço do meio é de adulto (nariz +0,4) e há filtro labial visível. O olho mede ≈ 1/4 da largura do rosto
  ou menos, com escala POR TIPO (redondo 0,85, amendoado 0,9).
- **Pescoço de adulto:** queixo em y 34,6 e gola em y 42,8. O pescoço nasce atrás do ângulo da mandíbula, **afina um
  pouco no meio** e o trapézio começa a descer **cedo** (perto de `Y(37,2)`), em curva, até a gola: a coluna visível fica
  curta, sem "polegar". Largura no máximo `NECK_JAW` da mandíbula no gônio: **0,64** no esguio e no curvilíneo, **0,7**
  no médio, 0,74 no plus e **0,8 só no largo e no atlético** (pescoço da largura da mandíbula vira tubo e masculiniza).
  Esternocleidomastoideo em V sutil (de trás das orelhas até a fúrcula) e sombra que a cabeça projeta no pescoço: forte
  colada na mandíbula, sumindo em ~2,5. Corpo largo: trapézio mais espesso e inclinado (`BodySpec.trap`, `slope`).
- **Ombros:** ≥ 2,4 larguras de cabeça no corpo médio (esguio ~2,2; largo e atlético ~2,8).
- **Perna:** a junta do quadril sai da proporção da perna (`BodySpec.leg`, 0,46–0,50 da altura); joelho a ≈ 0,27 da
  altura, canela do tamanho da coxa. **Pé** com ~13,6% da altura (`FOOT_LENGTH` ≈ 16,6 no corpo médio).
- **Estatura** de **0,953** (curvilíneo) / 0,958 (plus) a 1,04 (esguio) / 1,045 (atlético), em volta da sola (os pés
  nunca saem do lugar): ~11 de diferença no topo da cabeça, visível lado a lado sem sair do viewBox.
- **Cada avatar é uma pessoa diferente.** O formato do rosto mexe no crânio, nas maçãs, na mandíbula e no comprimento.
  O tipo de olho mexe na abertura, inclinação, pálpebra, tamanho e espaçamento. A sobrancelha muda forma e distância
  do olho. O nariz muda comprimento, asas e ponte. Largura da boca e espessura dos lábios são traços **da pessoa**
  (variação fina ±10% / ±22% pelo hash dos traços). A idade mexe em pálpebra, lábio, mandíbula, orelha e pescoço.
- **Repouso por pessoa** (`restOf`), **8 variantes, 5 com os dois braços soltos** (~62%: o gesto não se repete no
  elenco inteiro); as outras três: mão na cintura, polegar no bolso, polegar no passante. Contrapposto **sem "X"**:
  quadril do lado do peso sobe ~5°, **ombro desse lado 0,8 mais baixo**, pélvis 1,2 pro lado do apoio, pé de apoio
  embaixo do corpo, joelho livre no máximo ~1,5 pra dentro, calcanhar dele erguido.
- **Braço solto** (comprimento fixo, dois ossos): o braço quase cai reto. A dobra principal do cotovelo é **pra frente**
  (escorço do antebraço, `k2` 0,9); de frente o cotovelo dobra só **15°** (19° do lado do quadril alto) e o braço abre
  ~6–10° no corpo médio — nada de "pistoleiro" com o cotovelo espetado, nada de soldadinho. Pulso reto, mão pendendo a
  **0,8–1,5 da lateral da coxa**. Quadril largo (curvilíneo) ou barriga cheia (plus): a mão **encosta** na lateral do
  quadril, um pouco à frente (o braço abre ~16–22°, não vira asa).
- **Mão na cintura** (`hip`): pulso **fora** da silhueta do tronco, em cima da crista ilíaca; cotovelo pro lado (nunca
  cruza o tronco); a mão desce pela **lateral** do quadril em escorço, polegar escondido atrás. **Polegar no bolso**
  (`pocket`) e **no passante** (`soft`) saem por ângulos: o braço quase cai (a1 9–14°) e o antebraço vem pra frente em
  escorço até a mão pousar na frente do bolso (bolso) ou o polegar enganchar no cós (passante).
- **Sentado** (cadeira): cotovelo ao lado da cintura, antebraço vindo pra frente e pra dentro encurtado (≈ 80° no
  espaço, ~50° de frente), mão dobrada no pulso pousada em cima da coxa; a coxa é um trapézio curto visto de cima, com o
  plano de cima iluminado, sombra de contato da barra no alto da coxa e a face da frente do joelho na sombra (joelho
  largo e baixo, nada de cúpula brilhante). Perna longa (esguio, atlético): o colo fica mais comprido e a canela mais
  curta; `seatDropFor(cfg)` diz quanto o tronco desce pra essa pessoa (até +1,5) — a cena guarda em `scene.seatDrop` e a
  anatomia já usa quando existe.
- **Braço erguido** (aceno, comemoração): o contorno do braço tem a massa do deltoide no alto (+~0,6 no lado de fora),
  o vale da inserção, a curva do tríceps e a barriga do bíceps do lado de dentro — erguido, continua com volume.
- **Nunca deduza identidade pela aparência.** Nenhum item ou tipo de corpo é de "homem" ou de "mulher".
- **Premium vem da execução** (forma, luz, caimento e acabamento), não de neon, contorno grosso ou efeito.

## 2. Assinatura visual Metch

- **Olho.** Linha dos cílios como forma afilada: fina dentro, grossa no terço de fora, *flick* curto. Nada de cílio
  espetado. Íris com anel escuro, luz entrando por baixo, reflexo grande em cima à esquerda e um pequeno embaixo à
  direita. A pálpebra de cima faz sombra no branco e **cobre parte da íris**.
- **Nariz por planos, nunca por contorno.** Plano lateral da ponte em sombra à direita, luz estreita na ponte e na ponta,
  asas em crescente, cunha escura embaixo da ponta, sombra projetada no lábio. **Aquilino:** a luz da ponte é
  interrompida por um calombo (luz no alto, sombra logo abaixo) e a ponta cai. **Largo:** cada asa com volume próprio
  (sombra onde encontra a bochecha + luz no alto). **Arrebitado/pequeno:** sombra macia dos dois lados da ponte perto do
  canto do olho (a ponte existe).
- **Boca.** Lábio de cima mais escuro com arco do cupido, junção escura no meio, lábio de baixo com luz, depressão
  embaixo dele e filtro labial. No sorriso a bochecha sobe e empurra a pálpebra de baixo.
- **Expressões que se distinguem no busto de 56 px e na pele escura:** cada uma muda **pelo menos três sinais** —
  sobrancelha (altura, ângulo, assimetria), pálpebra de baixo (o sorriso de verdade sobe a pálpebra de baixo e estreita o
  olho) e boca. *Sorriso* = cantos sobem, bochecha aperta a pálpebra de baixo, sobrancelhas sobem de leve; *calmo* =
  olhar aberto e reto, sobrancelhas relaxadas mais baixas, boca reta; *descolado* = pálpebras de cima a ~40% e retas,
  olhar de lado, uma sobrancelha ~1 unidade mais baixa, boca de lado; *tímido* = começo das sobrancelhas sobe, olhar
  baixo e de lado, boca pequena, rubor; *sereno* = olhos fechados, começo das sobrancelhas erguido, sorriso suave;
  *sorriso de canto* = um canto sobe ~1,3 a mais com covinha e a bochecha do mesmo lado, a outra sobrancelha sobe;
  *apaixonado/estrela* = a íris vira a forma (maior), sobrancelhas erguidas, boca aberta. No `lite` a sobrancelha anda
  1,45× e os cantos da boca ~1,2× (`ampLite`).
- **Sobrancelha:** na pele clara, opacidade ~0,76 e começo mais fino e clareado pro tom da pele (sobrancelha escura e
  cheia em pele clara dá olhar severo); arqueada com arco moderado. Idade: afina um pouco e **nunca franze** (o que
  abaixa o começo ou a sobrancelha inteira perde ~60%).
- **Estrutura do rosto** com sombras recortadas de borda macia: crescente do lado da sombra, maçã, plano de baixo da
  mandíbula (mais leve na mandíbula macia), órbita, queixo com plano frontal. **Lado da luz quase sem sombra de borda**
  (pele clara ≤ 0,1): sombra forte nos dois lados vira contorno de adesivo ou "entalhe" anguloso.
- **Idade digna:** o rosto **não alarga**. A maçã afina um pouco (vão sob o malar), o ângulo da mandíbula amacia, a
  papada é uma sombra macia **abaixo** da linha da mandíbula (no pescoço), o lábio de cima afina, a pálpebra de cima cai
  um pouco — boca e sobrancelha ficam neutras ou sorridentes. Postura: ombro um pouco mais baixo e à frente, cabeça 0,4
  mais baixa (leve cifose), cintura um pouco mais cheia. O nariz não alonga com a idade quando já é longo (aquilino):
  nariz comprido + idade = "bruxa".
- **Rugas são VOLUME, nunca risco:** sombra curta e macia (desfocada, escurecimento **neutro** `ageShade`) com uma luz
  fina do lado de **cima** (a crista). Só três grupos: **sulco nasogeniano**, **2 linhas de testa** que acompanham o arco
  das sobrancelhas e **pés de galinha** (na expressão; nas linhas marcadas aparecem fracos sempre e fortes no sorriso).
  Nada de traço solto na bochecha, ruga entre as sobrancelhas ("bravo") ou linha de marionete ("boca caída"); a bolsa
  embaixo do olho é sombra larga e macia. No `lite`, metade da força.
- **Terço de baixo adulto:** queixo 0,25 mais longo em todos os formatos e mais largo no coração e no diamante (queixo
  pontudo e curto lê adolescente).
- **Pele escura:** nada de clareamento largo na maçã (vira mancha): um **especular pequeno e quente** (0,1–0,22) que segue
  o zigomático, luz de borda **fria** e fina (0,1) do lado da sombra, sombras de nariz e filtro **saturadas**
  (vermelho-marrom), não mais escuras; lábio de baixo com luz e comissuras escuras; esclera ~10% mais clara. Pele
  retinta (s8, s14): crescente de sombra da cabeça mais leve e o volume vem dos especulares (testa, ponte, ponta do
  nariz, queixo); dedos separados pela luz (nós e unhas mais claros) e sombra das pontas mais leve.
- **Vitiligo:** manchas de borda **nítida** (desfoque 0,12) em lóbulos largos e macios, como contorno de mapa.
- **Roteiro de cor:** luz principal quente vinda de cima e da esquerda; preenchimento frio. Borda do lado da sombra:
  azulada fraca (≤ 0,08) na pele clara, **marrom-avermelhado de luz rebatida (≤ 0,16) na pele escura**; só do crânio à
  quina da mandíbula (nunca chega ao queixo).

## 3. Luz, cor e volume

- **Regra de cada forma:** base com gradiente + 1 a 3 **formas de sombra recortadas** (`cp`, desfoque 0,3–0,6) + luz
  suave + oclusão nas junções. Nada chapado sozinho, nada só degradê.
- **Sombra de contato/oclusão SEMPRE recortada no que a recebe** (`cp` = tronco/roupa): o desfoque nunca cai no fundo
  (nada de "fantasma" entre o braço dobrado e o corpo).
- **Gradientes discretos:** claro → escuro de ~20–30% numa forma.
- **Membros:** gradiente do **membro inteiro** (`legAxis` / `armAxis` com `cylGradient`) nas duas metades.
- **Contornos raros e finos**, só onde ajudam a leitura (cílios, junção dos lábios).
- **Pele:** `skinTones(hex)` dá `light`, `lighter`, `shade`, `deep`, `form`, `blush`, `lip` e `line`. Pele bem escura
  (`dark`) tem brilhos mais frios; tons de fantasia (`fantasy`) ganham brilho iridescente discreto.
- **Paleta da marca no premium:** lima `#7FFF00`, magenta `#FF1493`, dourado `#FFD700`, fundo `#0A0A1A`.

## 4. Materiais (receitas)

| Material | Receita |
|---|---|
| Tecido | Gradiente do tronco ou do membro inteiro. `creases()`: vale macio + crista de luz, dobras **curtas e diagonais**, assimétricas, nunca em grade. Opacidade 0,25–0,3, desligadas no lite. |
| Camiseta | **Sempre por fora**, barra 1,5–3 abaixo do cós (`teeHemY`): o cós nunca aparece como faixa. Barra desce ~0,8 no meio, **sobe nas laterais e tem canto arredondado** (`torsoPts(an, { round: 1 })`). Corpo de cintura marcada: a camiseta sugere a cintura (drape baixo); barriga cheia: acompanha peito e barriga, com luz na projeção da barriga, sombra embaixo dela e dobra de tensão horizontal abaixo do peito, barra subindo no meio. Corpo largo: menos folga no ombro. |
| Manga | Copa achatada, 0,4–0,6 de folga, sem sino, boca inclinada. **Repinte a cava no grupo `body`** (ver `teeSleeves`). A copa assenta no deltoide (folga ≈ 40% no alto, cheia a partir da metade do braço); do pico do deltoide o tecido cai quase reto (manga curta) ou em linha até o cotovelo (manga longa), nunca no vale do braço. |
| Jeans | Gradiente da perna inteira, **trama de sarja** (diagonais finas, `weave`, 0,05, só no completo), desbotado na coxa, riscos claros no joelho, bigodes no gancho, costura lateral e pesponto. Com camiseta por fora, o quadril da calça começa logo acima da barra (`teeHemY − 2,2`). **Barra quebra na lingueta:** borda curva, mais alta no meio e mais baixa nos lados, dobra macia acima e pesponto. Sentado: plano de cima da coxa claro (trapézio), joelho só com luz macia, linhas de tensão do quadril ao joelho. |
| Calçado | **Pé 3D** (`footFrame`/`footHull`). Valores separados: solado escuro fino, **entressola creme** com friso, cabedal na cor do tênis com brilho macio, biqueira com costura em U, faixas dos ilhoses, **cadarço cruzado com ilhoses**, lingueta acima do cadarço, contraforte e colarinho do calcanhar. |
| Couro / metal / vidro | `leather()` (especular duro), `metal()` (faixas na diagonal), `glass()` (tinta translúcida + reflexo diagonal). |
| Cabelo curto | Tufos girando do redemoinho; **franja em duas profundidades** (a de trás mais escura) com **pontas arredondadas** (nada de dente de serra); costeleta de **borda nítida** e degradê só no fim; brilhos finos agrupados por tufo. Cabelo claro: sombra na testa no tom fundo do próprio cabelo (0,25). |
| Cabelo longo | **Risca reta** com fresta de pele (0,3) e sombra de raiz dos dois lados; o volume sobe ~0,6 dela; **entradas leves nas têmporas** e 2 mechinhas finas escapando pra testa. Massa feita de **mechas em S** (4 por lado, larguras diferentes, pontas em comprimentos desencontrados, a de trás mais escura), fresta escura no lado de dentro de cada mecha, **brilhos anisotrópicos finos, 2 por mecha**; uma mecha cai **por trás do ombro** (`longBack`); fios soltos curvos que seguem a forma (nunca reto, nunca antena). |
| Cacheado | Cachos como **fitas em C/S** (sem espiral desenhada): oclusão dentro da curva, luz no arco de fora, sombra própria no de dentro, tamanhos 0,6–1,4 e alguns rompendo a silhueta. Calota de cabelo por baixo (couro cabeludo nunca aparece). Massa de trás **só até a mandíbula** (nada de placa lisa atrás do queixo). Cabelo claro: massa de trás `mix(base, deep, 0,4)`, sem anel mais claro. |
| Crespo | Massa esférica de contorno macio e **irregular** (bossas grandes e pequenas, nunca festonado regular), borda um passo mais escura (cabelo claro: sem halo cinza), luz de topo larga, microcachos traçados. Topo limitado a y ≥ 1. |
| Pele | Ver `parts/body.ts`: crescentes de sombra na cabeça, órbitas, maçãs, plano da mandíbula, papada (idade), rótula, cotovelo, pescoço com esternocleidomastoideo. |

## 5. Medidas, espessuras mínimas e legibilidade

- viewBox **0 0 100 140**, **sola em y=134** (bola do pé; a ponta pode descer até ~135), **chão/sombra em y=135**.
  Sentado, a sola fica no apoio (`SEAT_SOLE_Y` 132,4). Tudo dentro do viewBox; braços erguidos com as mãos em y ≥ 1.
- Teste sempre: **48 px** (lista, corpo inteiro), **56 px** (miniatura, busto) e o raster real do mapa
  (`images/draw.ts`, 72×112 dp, com `MAP_HEAD_SCALE` 1,24). Olhos e boca viram manchas legíveis.
- **Detalhe com menos de 0,6 unidade some no mapa**: use pra volume, não pra informação.
- Traços: mínimo 0,25. Costura fina: 0,14–0,22. Linha dos cílios: 0,3–0,45, **≥ 0,62 no lite** (0,72 na pele escura).
- **Desfoque (`b`):** só a partir de 0,1. No lite, `lodCtx()` tira o desfoque abaixo de 1,2 e baixa 20% da opacidade.
- **Lite:** braço e perna engrossam ~0,2 (`liteEase`), íris escura e sobrancelha ganham contraste; pele escura ganha
  esclera ~10% mais clara e luz fina no arco da sobrancelha; vincos, trama, cadarço extra e brilhos miúdos somem.

## 6. Âncoras (avatar padrão: corpo "regular", rosto "oval", olho "almond", repouso "polegar no passante", peso na esquerda)

Mapa visual em `scratchpad/avatar/art/anchors.png`. Use **sempre as funções**, não os números.

| Junta / âncora | (x, y) | Função |
|---|---|---|
| ombro (pivô) L / R | (35,0, 46,6) / (65,0, 45,0) | `an.joints.shoulderL/R` (o L é o do apoio: 0,8 mais baixo) |
| cotovelo L / R | (31,5, 64,4) passante · (67,1, 63,1) solto | `an.joints.elbowL/R` (braço 18,2 · antebraço 15,6 = `an.armLen`) |
| pulso L / R | (37,0, 70,2) · (65,1, 76,9) | `an.joints.wristL/R` |
| quadril L / R | (42,2, 73,4) / (54,6, 76,3) | `an.joints.hipL/R` (junta em `an.hj` = 74,8) |
| joelho L / R | (43,8, 100,4) / (54,3, 101,4) | `an.joints.kneeL/R` |
| tornozelo L / R | (45,3, 127,4) / (58,2, 126,8) | `an.joints.ankleL/R` (`ankleAboveSole(footScale(an))` acima da sola) |
| base do pescoço / gola | (50, 41,5) / (50, 42,8), meia-largura 6,8 (pescoço 4,1) | `bodyAnchors(an).neck/collar`, `an.collarY`, `an.collarW`, `an.w.neck` |
| peito / cintura / quadril / colo | (50, 53) / (50, 65,2) / (50, 75,2) / (50, 75,8) | `bodyAnchors(an)`, `an.waistY`, `an.hipY` |
| gancho | y 79,7 | `an.torsoBottom` |
| palmas L / R | (40,4, 73,7) / (64,4, 81,8) | `bodyAnchors(an).palmL/R` |
| ombro do pet / pés | (65,4, 40,7) / (44,6, 133,5) e (59,7, 133,2) | `bodyAnchors(an).shoulderPerch / footL/R` |
| topo do crânio / linha do cabelo / testa | (50, 12,4) / y 15,6 / (50, 17,8) | `faceDims(an).crownY`, `headAnchors(an).hairline/forehead` |
| sobrancelhas / olhos L e R | y 21,4 / (46,4, 23,5) e (53,6, 23,6), meia-largura 1,93 | `headAnchors(an).browY / eyeL/R / eyeW / eyeS` |
| ponte / ponta do nariz | (50, 23,8) / (50, 28,6), asas ±1,89 | `headAnchors(an).noseBridge / nose / noseW` |
| boca / queixo | (50, 30,9), meia-largura 2,79 / (50, 34,6) | `headAnchors(an).mouth / mouthW / lipUp / lipLo / chin` |
| orelhas L / R | (42,5, 25,4) / (57,5, 25,4) | `headAnchors(an).earL/R`, `earShapes(an, s)` (encostadas na cabeça) |
| maçãs (luz) L | (44,3, 25,5) | `headAnchors(an).cheekboneL/R` |
| nuca / pivô da cabeça | (50, 30,0) / y 32,6 | `headAnchors(an).nape`, `headPivotY(an)` |

- O **queixo fica fixo** (y = 34,6 na estatura 1) pra todo formato de rosto: o rosto longo cresce pra cima.
- Tabela dos corpos (estatura · topo do crânio · junta do quadril · joelho · larguras ombro/cintura/quadril · perna ·
  cabeças · pescoço/mandíbula): esguio 1,04 · 7,8 · 70,9 · 98,8 · 33/19/22 · 0,50 · 5,53 · 0,57 — médio 1 · 12,4 ·
  74,8 · 100,9 · 37/24/26 · 0,485 · 5,47 · 0,64 — largo 1,03 · 8,9 · 74,9 · 100,9 · 42/34/32 · 0,47 · 5,51 · 0,79 — plus
  0,958 · 17,2 · 80,0 · 103,7 · 39/36/38 · 0,46 · 5,42 · 0,74 — curvilíneo 0,953 · 17,8 · 78,4 · 102,9 · 34/20/35 · 0,48 ·
  5,41 · 0,61 — atlético 1,045 · 7,2 · 71,3 · 98,9 · 43/22/25 · 0,49 · 5,53 · 0,73.
- Repouso: `an.rest` = `{ id 0..7, weight, armL, armR: 'hang'|'hip'|'pocket'|'soft'|'lap', wide }`. Animação que mexe nos
  braços: some `restArmDelta(an)` pra partir do braço solto em qualquer pessoa (a folha faz isso nas poses: `fromHang`).
- Busto: `AVATAR_BUST_VIEWBOX` (fixo `{27,5, 1,5, 45, 45}`, cobre todas as estaturas e o black power) ou
  **`bustViewBox(an, cfg)`** (por pessoa: topo 1 acima do cabelo pela tabela `HAIR_LIFT`, olhos a 42% da altura).

## 7. Contrato de camadas (o que vai onde)

Ordem do `layers.ts` (1 → 26). Os pontos que pegam:

- **Pescoço (etapa 16) cobre tudo acima da curva do decote.** Na roupa, use `torsoPath(an, { collar: true })` e
  desenhe a gola logo abaixo de `necklinePath(an)`. Pra gola alta, exporte `neckCoverY(cfg, an)` em `clothes.ts`.
- **A barra acompanha o quadril** (`torsoPath(an, { bottom, round })` inclina com `an.tilt.hip` e segue a pélvis).
- **Calça × camiseta:** a camiseta envolve a calça entre a cintura e a barra; o quadril da calça começa em
  `teeHemY(ctx) − 2,2`. A coxa (`thighPath`) prolonga só 4 pra cima, com o lado de fora quase sem subir (não espia
  pela lateral). O quadril de toda peça de baixo tem de caber o topo das coxas (`hip ≥ legSep + thigh`).
- **Sentado** (`an.seated`): o tronco termina no assento; desenhe a canela antes da coxa; a coxa é um trapézio curto
  (largo no quadril, estreito no joelho) visto de cima; a barra pousa no colo.
- **Pele do tronco não existe por padrão** (o tronco é a roupa). Peça que mostra pele chama `torsoSkin(ctx, opts)`.
- **Calçado:** `footFrame(an, s)` dá o projetor `P(u, v, h)` do pé 3D e `footHull(fr, {...})` a silhueta de qualquer
  pedaço. A barra da calça é redesenhada por cima do calçado (curva, quebrando na lingueta).
- **Mão:** `handShapes(an, s)` = relaxada (no colo e na cintura dobra no pulso); `{ open: true }` = palma pra câmera
  (`opts.hands[s] === 'open'`). Braço erguido em pose = mão aberta (a relaxada vira "nadadeira").
- Cabelo da frente faz **sombra na testa recortada em `headAnchors(an).headPath`**.
- Expressão (olhos, sobrancelhas, boca, rubor, bochecha de um lado só, delineado, batom, pés de galinha) é sempre
  `k:'face'`.

## 8. API (assinaturas)

```ts
// anatomy.ts
buildAnatomy(cfg: { body } & Partial<AvatarConfig>, scene?: Partial<AvatarSceneInfo>): Anatomy
bodyY(an, y) · restOf(cfg, scene?) → RestSpec · restArmDelta(an) → { armL, foreL, armR, foreR }
bodySpec(id) · faceSpec(id) · faceDims(an) · headPivotY(an) · hashUnit(str) · seatDropFor(cfg) · NECK_JAW
bustViewBox(an, cfg?: { hair?, hat? }) → { x, y, w, h }          // HAIR_LIFT por cabelo
rigFromAnatomy(an, scene) · petAnchor(an, pose) · bodyAnchors(an) · headAnchors(an)
torsoPath / torsoPts(an, { top?, bottom?, ease?, hem?, collar?, drape?, round? }) · torsoProfile · torsoXAt(an, side, y, ease?)
necklinePath(an, { depth?, wide?, v? })
upperArmPath / forearmPath / thighPath / shinPath(an, side, { ease?, flare?, from?, to?, endExt?, slant?, capScale? })
limbWidthAt(an, limb, side, t) · legAxis(an, side) · armAxis(an, side)
footFrame(an, side) → { P(u,v,h), s, yaw, side, outer(v), inner(v), top(v) } · footYaw(an, side) · footScale(an)
ankleAboveSole(s) · footHull(fr, { ease?, toe?, topH?, v0?, v1?, h0?, h1?, wk? }) · footPts / footPath / footBox
handShapes(an, side, { open? }) → { hand, thumb, grooves, knuckle, nails, web, palm, tip }
headPath(an, ease?) · headPts · capPath(an, { lift?, bottomY?, fringe?, sideDrop? }) · earShapes(an, side)
jointPath · silhouettePaths · groundShadowPath
smoothPath(pts, closed?, s?) · taperPath(spine, widths | fn, { n?, round? }) · offsetPts · mirrorPts · sampleSpline
// constantes: SOLE_Y 134, GROUND_Y 135, SEAT_DROP 22, SEAT_SOLE_Y 132,4, NOMINAL_H 122, HEAD_SCALE 0,92,
//   CROWN_DY −11,1, EYE_SCALE 0,94 (±10% por pessoa), MAP_HEAD_SCALE 1,24, FOOT_LEN 11,6 (pé unitário), FOOT_SV 1,17, FOOT_SH 1,12,
//   FOOT_S 1,22, FOOT_PITCH 10, FOOT_LENGTH ≈ 16,6, HAIR_LIFT, BODY_SPECS (com trap), FACE_SPECS, EYE_PLACE,
//   BROW_GAP, NOSE_PLACE, LIP_PLACE

// shading.ts (sem mudança de API)
skinTones(hex) · mix(a, b, t) · lum(hex) · saturate(hex, k) · isLite(ctx) · lodCtx(ctx)
shapeGradient · roundGradient · cylGradient(a, b, wl, wr, cores) · vGradient(y1, y2, stops)
volume · contactShadow · rimLit · rimLight · highlight · occlusion(ctx, d, cp)
fold · crease · creases(ctx, list, base, opts) · seam
stripes · plaid · weave · leather · metal · glass · speckle · starPath · heartPath · blob
```

Exemplo: calça reta que acompanha o corpo (perna contínua no joelho) e começa logo acima da barra da camiseta.

```ts
export function bottom(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const { an } = ctx;
  for (const s of ['L', 'R'] as const) {
    const ax = legAxis(an, s);
    const gf = cylGradient(ax.a, ax.b, ax.wl + 1.3, ax.wr + 1.3, tons);   // mesmo gradiente nas duas metades
    ctx.withGroup(s === 'L' ? 'legL' : 'legR', () => ctx.push(thighPath(an, s, { ease: 0.95, flare: 0.3 }), cor, { gf }));
    ctx.withGroup(s === 'L' ? 'shinL' : 'shinR', () => ctx.push(shinPath(an, s, { ease: 0.95, flare: 0.45, endExt: 0 }), cor, { gf }));
  }
  const top = ctx.cfg.top === 'tee' ? Math.max(an.waistY + 1.5, teeHemY(ctx) - 2.2) : an.waistY + 1.5;
  ctx.withGroup('body', () => ctx.push(torsoPath(an, { top, ease: 0.95 }), cor, { gf: tronco }));
}
```

Exemplo: sombra de contato que nunca vaza pro fundo (recortada no tronco).

```ts
const tronco = torsoPath(an, { ease: 0.35, drape: 0.5 });
ctx.withGroup('body', () => ctx.push(blob(x, y, 1.2, 6), '#1A0A10', { o: 0.16, b: 1.1, cp: tronco }));
```

Exemplo: bota a partir do pé 3D (cano alto e bico alongado).

```ts
const fr = footFrame(an, s);
const cano = footHull(fr, { ease: 0.9, topH: 9, toe: 0.8 });
ctx.push(smoothPath(footHull(fr, { ease: 1.05, h1: 0.9, toe: 0.8 })), sola);
ctx.push(smoothPath(cano), couro, { gf: ... });
leather(ctx, smoothPath(cano), caixa, couro);
```

## 9. Desempenho e nível de detalhe

- **Orçamento do avatar padrão:** ~236 camadas, ~290 KB (path + recorte) e ~123 desfoques na versão completa; no lite
  ~159 camadas, ~162 KB e ~10 desfoques. Tetos do teste (`people.test.ts`): completo < 275 camadas e < 290 KB, lite < 180
  camadas, < 200 KB e < 20 desfoques (rodada 5: o teto de camadas subiu de 260 pra 275 com os itens novos). O longo é o mais pesado (~316 KB / ~180 KB); cacheado ~303 / ~171 KB. Junte formas da mesma cor e
  opacidade num path só; em textura repetitiva use arcos ou traços num path só; **não repita um path grande como
  recorte** de várias camadas (luz e sombra que ficam dentro da forma dispensam o `cp`).
- **`lod: 'lite'`** (miniaturas e mapa; declarado em `BuildOptions.lod` do `ctx.ts`, junto com `hands`): `ctx = lodCtx(ctx)` no começo de cada função e `isLite(ctx)` pra pular trama,
  pesponto, vinco, fio solto, cadarço extra e brilho miúdo; no lite use menos amostras (`taperPath(..., { n })`).
- Sem `Math.random`: sementes fixas (`hashUnit`, `rnd(seed)`).

## 10. O que evitar

- Retângulo, círculo perfeito ou tubo como corpo ou roupa; braço reto sem cotovelo; braço colado (soldadinho); perna
  rígida; **perna em X** (na perna cruzada, o joelho da frente dobra pra frente e pra fora); pé de pato.
- Rosto de criança: olho grande demais, cabeça grande, terço de baixo curto, bochecha cheia, pescoço curto e grosso,
  rubor no preset de rosto redondo + nariz arrebitado, queixo pontudo e curto.
- Pose de "pistoleiro" (cotovelo espetado pro lado com o pulso voltando pra dentro) e mão na frente da barriga ou da
  virilha; o mesmo gesto repetido no elenco inteiro.
- Pescoço-tubo da largura da mandíbula, subindo reto até a gola.
- Ruga como risco escuro uniforme; sobrancelha em V no rosto maduro; clareamento largo na maçã da pele escura.
- Rosto-caixa: mandíbula da largura das maçãs com queixo largo e reto; idade que alarga o rosto; pescoço da largura da
  mandíbula; sombra escura na quina da mandíbula macia.
- Contorno de adesivo: faixa escura na borda do lado da luz; linha que contorna até o queixo.
- Roupa em bloco: cós aparecendo como faixa, barra reta com canto vivo, quadril da calça saltando da camiseta, coxa
  espiando pela cintura.
- Sombra de oclusão sem recorte (mancha no fundo).
- Cabelo-capacete: risca em zigue-zague ("§"), fio em antena, cortinas paralelas com pontas iguais, franja em dentes,
  costeleta borrada, espiral "@" no cacho, placa lisa atrás do queixo, halo claro/cinza em volta do rosto.
- Calçado "pastilha": pé curto, sola e cabedal no mesmo valor, barra da calça cortada reta em cima do tênis.
- Contorno preto em volta de tudo; neon como "premium"; degradê forte; copiar marca ou personagem.
- Desfoque minúsculo (< 0,1) ou textura com centenas de formas preenchidas (use traço).

## 11. Como conferir

```sh
# dentro de apps/mobile, no git-bash
S="npx ts-node -T --skipProject -O '{\"module\":\"node16\",\"moduleResolution\":\"node16\",\"target\":\"es2022\",\"esModuleInterop\":true,\"jsx\":\"react\"}' scripts/avatar-sheet.ts"
$S --set hero --size 600 --cols 4 --label --out /caminho/absoluto/hero.png
$S --set people --size 400 --cols 6 --label --out /caminho/absoluto/people.png
$S --set faces --mode bust --size 230 --cols 6 --label --out /caminho/absoluto/faces.png
$S --set rests --size 400 --cols 4 --label --out /caminho/absoluto/repousos.png
$S --set poses --size 400 --cols 7 --label --out /caminho/absoluto/poses.png
$S --slot top --size 48 --cols 10 --out /caminho/absoluto/top48.png
$S --set hero --size 112 --renderer map --out /caminho/absoluto/mapa.png
```

- Use **caminho absoluto** no `--out`. A folha leva ~3 s por célula grande (o desfoque de verdade é caro): pra iterar,
  recorte (zoom) só o que está mexendo.
- Conjuntos prontos: `hero`, `people`, `bodies`, `faces`, `expressions`, `mature`, `details`, `rests`, `poses`,
  `samehair` e `seated`. Poses paradas: `hello`, `hip`, `dance`, `dance2`, `bend` e `cheer` (partem do braço solto de
  cada pessoa); células podem pedir `hands: { L|R: 'open' }`.

## 12. Rodada 5 (dono da base): o que mudou e quanto as âncoras andaram

Nenhuma assinatura mudou. Valores e formas:

- **Repouso:** 8 variantes (5 de braços soltos); braço solto com dobra lateral 15°/19° e escorço `k2` 0,9; mão na
  cintura com pulso fora do tronco; bolso e passante por ângulos. Cotovelos e pulsos de cada pessoa mudam (é pose),
  mas o comprimento do braço é o mesmo. Animações seguem somando `restArmDelta(an)`.
- **Estatura:** esguio 1,035 → 1,04; plus 0,97 → 0,958; curvilíneo 0,965 → 0,953. O topo da cabeça desce ~1,1–1,2 no
  plus e no curvilíneo e sobe ~0,6 no esguio; os pés não andam.
- **Rosto:** queixo 0,25 mais longo em todos (o queixo continua em y 34,6; o crânio sobe ~0,2 e os olhos ~0,1); coração
  e diamante com queixo e mandíbula um pouco mais largos. Olho `EYE_SCALE` 0,9 → 0,94 e ±10% por pessoa. Idade: cabeça
  0,4 mais baixa, ombro 0,3 mais baixo e 0,25 mais estreito.
- **Pescoço:** `BodySpec.neck` mais fino e teto `NECK_JAW` por corpo; trapézio começa em `Y(37,2)`.
- **Braço:** contorno do braço com deltoide (+~0,6) e bíceps/tríceps.
- **Novo:** `seatDropFor(cfg)` e `NECK_JAW`; `BuildOptions.lod` e `BuildOptions.hands` declarados no `ctx.ts`.
- **Orçamento:** as sombras e as luzes do pescoço (V do esternocleidomastoideo, clavículas) foram juntadas em uma camada
  de sombra e uma de luz (−2 camadas no corpo inteiro).
- **Quanto as âncoras andaram** (medido contra a rodada 4 em 6 corpos × 6 rostos × 6 olhos × 3 linhas, mesmo repouso):
  cabeça (olhos, orelhas, nariz, boca, queixo, linha do cabelo, topo do crânio) no máximo **1,34** (plus/curvilíneo com
  rosto longo e linhas marcadas); ombros 1,1; gola e base do pescoço 1,1; cintura e quadril 0,8; joelhos 0,4; tornozelos
  e pés 1,1. **Exceção, de propósito:** pulso e palma do braço solto no **plus e no curvilíneo** andam até **3,2** (a mão
  passou a encostar na lateral do quadril em vez de abrir em asa, e o cotovelo não espeta mais); no largo 1,3–1,9 e nos
  outros corpos ≤ 1,25. Tudo que segura objeto ou pulseira já lê `bodyAnchors(an).palmL/R` e `an.joints.wristL/R` e
  acompanha; quem usou número fixo perto da mão precisa conferir.
- `idle()` continua só com os campos antigos (sem antebraço), como os testes e as danças esperam.

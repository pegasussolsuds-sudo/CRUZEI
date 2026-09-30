// Listas do filtro de abuso (pt-BR). ARQUIVO DE DADOS: pra estender, acrescente uma linha na lista certa e um caso no
// text-filter.test.ts (o teste confere que todo padrão compila e segue as regras abaixo).
//
// Como escrever um padrão (regex aplicada no texto NORMALIZADO, sempre palavra inteira):
// - minúsculas, SEM acento e SEM letra dobrada: o texto chega com "ss"→"s", "rr"→"r" ("porra" vira "pora",
//   "esse" vira "ese", "arrombado" vira "arombado", "morrer" vira "morer"). O teste recusa padrão com letra dobrada.
// - EXCEÇÃO `rr: true`: o padrão casa numa visão que mantém "rr" (o resto normaliza igual: acento, leetspeak, letras
//   soltas, "rrr…"→"rr"). É só pra MORRER, que sem o "rr" vira MORAR ("morra" → "mora", "morre" → "more"). Nessa visão
//   o padrão escreve "rr" (e só "rr": outra letra dobrada continua proibida) e pode usar {morrer}. Nada de adivinhar
//   pelo contexto se "mora" é morar ou morrer: "mora" (um r) é SEMPRE morar.
// - palavras separadas por UM espaço; o padrão casa palavra inteira (nunca pedaço: "cu" não pega "cuscuz").
// - dá pra usar regex: [oa], s?, (?:a|b), (?! de) etc. Sem lookbehind (o app roda em Hermes).
// - atalhos {voce} {seu} {voce_e} {ofensa} {lgbt} {raca} {grupo} {menor} {idade} {nao_de} {brincadeira}: ver MACROS.
//   {morrer} (só com `rr: true`): ver RR_MACROS.
// - `in`: onde vale. Sem `in` = em tudo (mensagem, nome, bio, @). 'profile' = nome, bio e @. 'handle' = só nome e @.
//   'instagram' = só o @.
// - `notAfter`: palavra(s) que, logo ANTES do trecho, desfazem o achado (faz o papel do lookbehind): "tu morre viado".
// - `^` dentro do padrão = só no começo do texto ("^vendas?" pega "Vendas da Bia", não "Bia Vendas").
//
// O que cada motivo faz (text-filter.ts): em MENSAGEM, hate/threat/minor bloqueiam, scam passa e vira denúncia
// automática, profanity/sexual passam (conversa entre adultos). Em nome, bio e @, tudo recusa.
// Antes de mexer, pense no falso positivo: "manda bala" (vai fundo), "bala" (doce), "pelada" (futebol), "mora logo
// ali" e "mora gay no prédio" (morar), "vou te sequestrar pra jantar" e "sexo do bebê" são conversa normal.

import type { TextBlockReason } from '@cruzei/shared-types';

export type LexiconScope = 'profile' | 'handle' | 'instagram';

export interface LexiconEntry {
  /** regex no texto normalizado (palavra inteira) */
  p: string;
  /** motivo */
  c: TextBlockReason;
  /** onde vale (ausente = em tudo) */
  in?: LexiconScope;
  /** regex de palavra(s) que, logo antes do trecho, cancelam o achado (aceita atalhos) */
  notAfter?: string;
  /** casa na visão que mantém "rr" (formas de MORRER ≠ MORAR); só aqui vale escrever "rr" e usar {morrer} */
  rr?: true;
}

/** logo depois de "menor" é comparação, não idade: "com menor frequência", "de menor risco" (usado no atalho {menor}) */
export const MINOR_COMPARATIVE_AFTER: readonly string[] = [
  'frequencia', 'preco', 'precos', 'valor', 'valores', 'custo', 'custos', 'risco', 'riscos', 'chance', 'chances',
  'importancia', 'porte', 'tamanho', 'intensidade', 'quantidade', 'numero', 'tempo', 'duracao', 'distancia',
  'esforco', 'dificuldade', 'problema', 'problemas', 'impacto', 'grau', 'nivel', 'parte', 'interese',
  'vontade', 'escala', 'medida',
];

/**
 * logo depois de "menina de N" / "novinha de N" desfazem a idade: é cidade ("Sete Lagoas", "Três Corações", "Dois
 * Irmãos", "Quatro Barras", "Treze Tílias", "Quinze de Novembro", "Treze de Maio"…), medida, dinheiro, tempo ou
 * contagem ("dois metros", "15 minutos", "17 filhos"). Número logo depois também desfaz ("menino de 1,90" = altura).
 * Pode ter mais de uma palavra ("de maio"). Usado no atalho {idade} e em text-filter.ts.
 */
export const MINOR_AGE_UNDO_NEXT: readonly string[] = [
  // 2ª palavra de cidade com número no nome
  'lagoas', 'coracoes', 'rios', 'irmaos', 'pontas', 'baras', 'vizinhos', 'coroas', 'pasos', 'marias', 'tilias',
  'coregos', 'quedas', 'pontes', 'lajeados', 'aroios', 'cachoeiras', 'palmeiras', 'forquilhas', 'fronteiras',
  'riachos', 'ranchos', 'estradas', 'cantos', 'portas', 'ilhas',
  // "N de <mês>": cidade, bairro, rua ou data ("Quinze de Novembro", "Treze de Maio", "Sete de Setembro")
  'de janeiro', 'de fevereiro', 'de marco', 'de abril', 'de maio', 'de junho', 'de julho', 'de agosto', 'de setembro',
  'de outubro', 'de novembro', 'de dezembro',
  // medida, peso, dinheiro
  'metro', 'metros', 'm', 'cm', 'centimetros', 'km', 'quilometros', 'kg', 'quilo', 'quilos', 'kilo', 'kilos',
  'g', 'gramas', 'litro', 'litros', 'pes', 'polegadas', 'graus', 'real', 'reais', 'conto', 'contos', 'pila', 'pilas',
  'mil', 'dolares', 'euros',
  // tempo e contagem
  'hora', 'horas', 'h', 'hr', 'hrs', 'minuto', 'minutos', 'min', 'segundo', 'segundos', 'dia', 'dias', 'semanas',
  'meses', 'vez', 'vezes', 'filhos', 'filhas', 'gatos', 'cachoros', 'andares', 'pontos', 'gols', 'tatuagens',
  'piercings', 'seguidores',
];

/** atalhos usados nos padrões (já normalizados: sem acento, sem letra dobrada) */
export const MACROS: Record<string, string> = {
  // menor de idade, não comparação ("sexo com menor frequência")
  menor: `(?:menor|menores)(?! (?:${MINOR_COMPARATIVE_AFTER.join('|')})(?: |$))`,
  // idade de menor em dígito (o número por extenso já chega como dígito na visão de idade), sem cidade/medida logo
  // depois: "novinha de 15" sim, "novinha de Sete Lagoas" / "de dois metros" não
  idade: `(?:1[0-7]|[1-9])(?! (?:${MINOR_AGE_UNDO_NEXT.join('|')}|[0-9]+)(?: |$))`,
  voce: '(?:voce|voces|vc|vcs|ce|tu)',
  // "vou te matar DE saudade", "te mato DE beijo": com "de" logo depois não é ameaça (fora "de novo"/"de vez")
  // 'de' + carinho/exagero desfaz a ameaça ('vou te matar de saudade', 'espero que vc morra de rir'); qualquer outro
  // complemento continua ameaça ('morra de câncer', 'te matar de porrada', 'de novo', 'de vez')
  nao_de:
    '(?! de (?:rir|tanto rir|vez em quando|saudades?|inveja|vergonha|amor|tesao|calor|frio|tedio|sono|cansaco|curiosidade|ciumes?|felicidade|alegria|velhice|orgulho|emocao|paixao|beijos?|abracos?|cocegas?|carinho|susto|raiva|fofura)(?: |$))',
  // "surra DE beijo", "te arrebento NO truco": carinho e jogo não são ameaça
  brincadeira:
    '(?! (?:de (?:beijos?|beijinhos?|beijocas?|carinhos?|cheiros?|chamegos?|abracos?|amor|cocegas|mordidinhas?|dengo|saudade)|(?:no|na) (?:fifa|truco|xadrez|uno|jogo|game|videogame|video game|sinuca|baralho|domino|pebolim|ping pong|quadra|futebol|volei|lol|fre fire|mario kart|boliche|poker|play|corida))(?: |$))',
  seu: '(?:seu|sua|seus|suas|teu|tua|ese|esa|eses|esas)',
  voce_e: '(?:voce|vc|tu|ce) (?:e|eh|es|parece|virou) (?:um |uma )?',
  // só pra adjacência ("gay nojento"): "doente"/"inferior" ficam de fora ("meu amigo gay doente em casa");
  // "gay é doente" é pego pela regra de "{grupo} é …"
  ofensa:
    '(?:nojent[oa]s?|imund[oa]s?|fedid[oa]s?|lixo|lixos|de merda|desgracad[oa]s?|aberacao|aberacoes|escoria|praga)',
  lgbt:
    '(?:gays?|viad[oa]s?|viadinh[oa]s?|bichas?|bixas?|sapatao|sapataos|sapatonas?|lesbicas?|travestis?|travecos?|trans|bisexuais|bisexual|boiolas?|baitolas?)',
  raca: '(?:negr[oa]s?|macac[oa]s?|crioul[oa]s?|nordestin[oa]s?|judeus?|judias?|macumbeir[oa]s?|indi[oa]s?)',
  grupo:
    '(?:gays?|viad[oa]s?|bichas?|sapatao|sapataos|sapatonas?|lesbicas?|travestis?|travecos?|trans|boiolas?|baitolas?|negr[oa]s?|pret[oa]s?|macac[oa]s?|crioul[oa]s?|nordestin[oa]s?|judeus?|judias?|macumbeir[oa]s?)',
};

/**
 * atalhos que só valem em padrão `rr: true` (visão que mantém "rr"): usar fora dela é erro, porque ali "morra" já
 * virou "mora" (morar)
 */
export const RR_MACROS: Record<string, string> = {
  // só as formas que MANDAM morrer ("morra", "morram", "morre"): "morrer"/"morreu" ficam de fora — "melhor morrer gay
  // que viver mentindo", "meu tio morreu gay" são orgulho/história; "morrendo" também ("tô morrendo, viado kkk")
  morrer: '(?:morra|morram|morre)',
};

/**
 * trechos inocentes que parecem outra coisa: saem do texto antes da busca (cidade "Ponta Porã", "pica-pau",
 * "educação sexual", "sexo do bebê"…). Normalizados, palavra inteira.
 */
export const ALLOWLIST: readonly string[] = [
  'ponta pora',
  'cunha pora',
  'pica pau',
  'educacao sexual',
  'orientacao sexual',
  'saude sexual',
  'abuso sexual',
  'asedio sexual',
  'violencia sexual',
  'exploracao sexual',
  'sexo do bebe',
  'sexo da crianca',
  'sexo do nenem',
  'cha revelacao',
  // bicha = verme ("remédio pra matar a bicha")
  'remedio pra matar a bicha',
  'remedio pra matar as bichas',
  'remedio para matar a bicha',
  'remedio para matar as bichas',
];

export const LEXICON: readonly LexiconEntry[] = [
  // ─────────────────────────── ódio: injúria racial, LGBTfobia, intolerância ───────────────────────────
  // termos que são ofensa em qualquer contexto
  { p: 'travecos?', c: 'hate' },
  { p: 'boiolas?|baitolas?', c: 'hate' },
  { p: 'crioul[oa]s?', c: 'hate' },
  { p: 'ticao|picole de asfalto|cabelo de bombril|macaco de imitacao', c: 'hate' },
  { p: '(?:volta|voltar|lugar de preto e) (?:pra|para|na) senzala', c: 'hate' },
  { p: 'heil hitler|sieg heil|poder branco|white power', c: 'hate' },
  // "seu viado", "essa sapatão", "você é um macaco"
  { p: '{seu} (?:viad[oa]|viadinh[oa]|bicha|bixa|sapatao|sapatona|traveco|boiola|baitola|crioul[oa]|macumbeir[oa])s?', c: 'hate' },
  { p: '(?:seu|sua|teu|tua|seus|suas) macac[oa]s?', c: 'hate' },
  { p: '{voce_e}(?:macac[oa]|viad[oa]|bicha|sapatao|traveco|boiola|crioul[oa])', c: 'hate' },
  // grupo + ofensa: "gay nojento", "negro imundo", "nordestino lixo" (preto/preta sem "sujo": é cor de coisa)
  { p: '{lgbt} {ofensa}', c: 'hate' },
  { p: '{raca} (?:{ofensa}|suj[oa]s?)', c: 'hate' },
  { p: 'pret[oa]s? (?:nojent[oa]s?|imund[oa]s?|fedid[oa]s?|de merda|desgracad[oa]s?|macac[oa]s?)', c: 'hate' },
  // grupo + "é doença / tem que morrer", "morte aos gays", "odeio gay"
  { p: '{grupo} (?:e|eh|sao|tudo e) (?:um |uma )?(?:doenca|doente|doentes|aberacao|praga|escoria|inferior|inferiores|sub raca|subraca|nojent[oa]s?|coisa do capeta)', c: 'hate' },
  { p: '{grupo} (?:tem|tinha|tinham|deveriam|deviam|merecem|vao) (?:que |de )?(?:morer|apanhar|sumir|queimar|ser exterminad[oa]s|ser mort[oa]s|levar tiro)', c: 'hate' },
  // "mata a bicha", "matar os gays" ("acabar com a preta" fica: é cerveja, roupa…)
  { p: '(?:morte aos|morte as|matar|mata|exterminar|queimar|acabar com) (?!(?:o|a|ese|esa) pret[oa](?: |$))(?:os |as |o |a |todos os |todas as |eses |esas |ese |esa )?{grupo}', c: 'hate' },
  // MORRER + grupo ("morra viado", "morre bicha", "lixo, morra viado", "morra viado aqui"), em QUALQUER lugar da frase.
  // Casa na visão com "rr" (`rr: true`): "mora gay no prédio" / "na minha rua mora travesti" é MORAR e nunca entra aqui.
  // Não conta quando quem morre é o sujeito ou é vocativo: "tu morre viado kkk", "quem nasce gay morre gay", "nasci gay
  // e vou morrer gay", "ele vai morrer gay" ("vc vai morrer" é pego como ameaça lá embaixo)
  {
    p: '{morrer} {lgbt}',
    c: 'hate',
    rr: true,
    notAfter:
      '(?:{voce}|eu|ele|ela|eles|elas|quem|gente|{lgbt}(?: e)?)(?: (?:vai|vao|ia|iam|quer|querem))?|vou|vo|vamos|quero|queria|prefiro',
  },
  { p: 'odeio (?:gays?|viad[oa]s?|bichas?|sapataos?|sapatonas?|lesbicas?|travestis?|travecos?|trans|negr[oa]s?|macac[oa]s?|nordestin[oa]s?|judeus?|macumbeir[oa]s?)', c: 'hate' },
  // termos de identidade usados por quem é (bicha, sapatão, viado): na bio e na conversa dependem do contexto
  // (as frases acima pegam o uso ofensivo); no NOME e no @ não rolam
  { p: 'viad[oa]s?|viadinh[oa]s?|viadao|bichas?|bixas?|sapatao|sapatonas?', c: 'hate', in: 'handle' },

  // ─────────────────────────── ameaça (e incentivo a se machucar) ───────────────────────────
  // "vou te sequestrar" fica de fora de propósito (cantada comum: "vou te sequestrar pra jantar")
  { p: '(?:vou|vo|vamos|eu vou|quero|a gente vai) te (?:matar|mata){nao_de}', c: 'threat' },
  { p: 'te mato{nao_de}', c: 'threat' },
  { p: '(?:vou|vo|eu vou|quero) matar {voce}{nao_de}', c: 'threat' },
  { p: '(?:vou|vo|eu vou|vamos) te (?:estuprar|estrupar|esfaquear|espancar|degolar|furar|queimar|encher de (?:porada|soco|socos|tapa|tapas)|socar)', c: 'threat' },
  // estes têm uso de carinho/jogo: "vou te dar uma surra de beijo", "vou te arrebentar no truco"
  { p: '(?:vou|vo|eu vou|vamos) te (?:enforcar|arebentar|quebrar|dar uma sura|dar uma surinha|bater){brincadeira}', c: 'threat' },
  { p: '(?:vou|vo|eu vou|vamos) (?:estuprar|estrupar|esfaquear|espancar|degolar) (?:{voce}|ela|ele|sua|seu|tua|teu)', c: 'threat' },
  { p: '(?:vou|vo|eu vou) quebrar (?:sua|tua) cara', c: 'threat' },
  { p: 'te (?:estupro|estrupo|esfaqueio|espanco|degolo)', c: 'threat' },
  { p: 'te arebento{brincadeira}', c: 'threat' },
  { p: '(?:vou|vo|eu vou) (?:te )?(?:dar|meter|enfiar) (?:um |uns |uma |umas )?(?:tiro|tiros|facada|facadas)', c: 'threat' },
  { p: '{voce} vai (?:levar|tomar) (?:um |uns |uma )?(?:tiro|tiros|facada|facadas)', c: 'threat' },
  { p: '(?:meto|meter|encho|encher) (?:de )?bala', c: 'threat' },
  { p: '{voce} vai morer{nao_de}', c: 'threat' },
  // MORRER na visão com "rr": "espero que vc more perto" e "ela mora logo ali" são MORAR e nem chegam aqui. "morra de
  // rir / de saudade", "morra comigo" (envelhecer junto), "não quero que vc morra" e "morre logo depois" (filme) não
  // são ameaça
  {
    p: '(?:tomara|espero|quero) que {voce} (?:morra|morre|se mate){nao_de}(?! (?:comigo|junto|juntos)(?: |$))',
    c: 'threat',
    rr: true,
    notAfter: 'nao|n|nunca|jamais',
  },
  { p: 'morr[ea] logo(?! ali| ai| aqui| la| perto| depois| na| no| em| do| da| ao| atras| a )', c: 'threat', rr: true },
  { p: 'sei onde {voce} (?:mora|trabalha|estuda|fica|dorme)', c: 'threat' },
  { p: 'sei (?:o )?(?:seu|teu) endereco', c: 'threat' },
  // expor / vazar fotos (sextorsão)
  { p: '(?:vou|vo|eu vou) (?:vazar|espalhar|postar|divulgar|mandar|publicar|jogar na net) (?:as |os )?(?:suas|tuas|seus|teus) (?:fotos|foto|nudes|nude|videos|video|prints|print|conversas|mensagens|intimidades)', c: 'threat' },
  { p: '(?:vou|vo|eu vou) te expor{nao_de}|(?:vou|vo|eu vou) expor {voce}', c: 'threat' },
  { p: '(?:se|caso) (?:{voce} )?(?:nao|n) (?:me )?(?:pagar|mandar|depositar|fizer|transferir)(?: [a-z0-9]+){0,6} (?:vou|vo|eu vou) (?:vazar|espalhar|postar|divulgar|mandar|expor|publicar)', c: 'threat' },
  // incentivo a se machucar
  { p: '(?:vai|va|pode ir|vai logo) se matar{nao_de}', c: 'threat' },
  { p: 'se (?:mata|mate) (?:logo|sua|seu|pora|desgraca|lixo)', c: 'threat' },

  // ─────────────────────────── sexual envolvendo menor (sempre bloqueia) ───────────────────────────
  // (a regra de proximidade "menor + termo sexual" usa as listas MINOR_* lá embaixo)
  { p: 'pornografia infantil|porno infantil|pedo ?porn[oa]?|cp infantil|sexo infantil', c: 'minor' },
  { p: '(?:nudes?|pack|packs|fotos? intimas?|videos? intimos?|fotos? pelad[oa]s?) (?:de|da|do|das|dos) (?:{menor}|crianca|criancas|novinha de {idade}|ninfetas?)', c: 'minor' },
  { p: '(?:crianca|criancas|criancinha|criancinhas|menor|menores|ninfetas?|(?:menina|menino|garota|garoto|novinh[ao]s?|mina|guria|gatinha) de (?:1[0-7]|[1-9])(?: anos)?) (?:pelad[oa]s?|nua|nuas|nu|nus|sem roupa|fazendo sexo|transando)', c: 'minor' },
  { p: '(?:sexo|transar|transo|transaria|foder|fuder|pegar|porno|pornografia|punheta|videos? de sexo|fotos? de sexo) (?:com|de|da|do|das|dos|envolvendo) (?:uma |um |umas |uns )?(?:{menor}|crianca|criancas|criancinha|criancinhas|ninfeta|ninfetas|preadolescentes?)', c: 'minor' },
  { p: '(?:tesao|excitad[oa]|atraid[oa]|atracao|punheta|siririca) (?:por|em|com|pensando em) (?:uma |um )?(?:crianca|criancas|criancinha|criancinhas|{menor}|novinh[ao]s? de {idade})', c: 'minor' },
  { p: 'ninfetas?', c: 'minor', in: 'profile' },

  // ─────────────────────────── palavrão / ofensa (só nome, bio e @) ───────────────────────────
  { p: 'pora|poras|caralh[a-z]*|krl|carai|caraio|merda|merdas|bosta|bostas', c: 'profanity', in: 'profile' },
  { p: 'put[oa]s?|putinh[oa]s?|putona|puteiro|fdp|filh[oa]s? da puta|pqp|puta que pariu', c: 'profanity', in: 'profile' },
  { p: 'fod(?:a|as|ase|a se|er|e|eu|ido|ida|idos|idas|endo|ao)|vai se foder|vsf|vtnc|tnc|tmnc|vai tomar no cu', c: 'profanity', in: 'profile' },
  { p: 'cu|cus|cuzao|cuzona|cuzinho|arombad[oa]s?', c: 'profanity', in: 'profile' },
  { p: 'desgracad[oa]s?|vagabund[oa]s?|vadias?|escrot[oa]s?|corn[oa]s?|otari[oa]s?', c: 'profanity', in: 'profile' },
  // piranha também é peixe ("Pescador de piranha") e presilha de cabelo
  { p: 'piranhas?(?! de cabelo)', c: 'profanity', in: 'profile', notAfter: '(?:pescador|pescadora|pescadores|pesca|pescaria|caldo|aquario)(?: de)?|pescar|pesco|pesquei' },
  { p: 'retardad[oa]s?|mongoloides?|debil mental', c: 'profanity', in: 'profile' },

  // ─────────────────────────── conteúdo sexual explícito (só nome, bio e @) ───────────────────────────
  { p: 'bucet[a-z]*|bocet[a-z]*|bct|xoxot[a-z]*|xerec[a-z]*|xotas?|piroc[a-z]*|punhet[a-z]*|siririca|boquetes?|boquetinho', c: 'sexual', in: 'profile' },
  { p: 'putaria|putarias|gozada|mamada|sexo anal|porno|pornografia|caralhudo|pauzudo|dotad[oa] de 2[0-9] cm', c: 'sexual', in: 'profile' },
  // no @ e no nome (na bio "não mando nudes" é comum)
  { p: 'nudes?|packs?|sexo|hot|safad[oa]s?|safadinh[oa]s?', c: 'sexual', in: 'handle' },

  // ─────────────────────────── golpe: dinheiro, Pix, dados, venda ───────────────────────────
  // pedido de dinheiro / Pix ("te mando o pix" pra rachar a conta não entra: o golpe é pedir)
  { p: 'me (?:manda|mande|envia|envie|pasa|transfere|transfira|deposita|deposite|empresta|empreste|aruma|aranja|da|de|faz|faca) (?:um |uma |o |a |uns |umas |aquele |aquela |so )?(?:pix|pixzinho|dinheiro|dinheirinho|grana|graninha|transferencia|deposito|trocado|trocadinho|dim|[0-9]+ reais|[0-9]+ conto|[0-9]+ contos)', c: 'scam' },
  { p: '(?:manda|mande|envia|envie|faz|faca|transfere|deposita) (?:um |uma |o |uns )?(?:pix|pixzinho|dinheiro|grana|transferencia|deposito|[0-9]+ reais) (?:pra|para) (?:mim|eu|minha|meu)', c: 'scam' },
  { p: '(?:manda|mande|envia|envie) (?:um |uns )?pix', c: 'scam' },
  { p: '(?:minha |a minha )?chave (?:do )?pix|meu pix|meu pixzinho|pix pra mim|pix para mim', c: 'scam' },
  { p: 'pix (?:e |eh )?[0-9]{5,}', c: 'scam', in: 'profile' },
  { p: '(?:preciso|precisando|to precisando|estou precisando|necesito) (?:muito )?(?:de )?(?:um dinheiro|uma grana|um pix|uma ajuda financeira|ajuda financeira|um emprestimo|emprestimo|[0-9]+ reais|(?:uma )?ajuda com (?:o |a )?(?:aluguel|conta|boleto))', c: 'scam' },
  { p: '(?:pode|poderia|consegue) me (?:emprestar|ajudar com (?:um |uma )?(?:dinheiro|grana|pix))', c: 'scam' },
  { p: '(?:me )?empresta (?:um |uma |uns )?(?:dinheiro|grana|[0-9]+)', c: 'scam' },
  { p: '(?:taxa|valor) (?:de|da|do) (?:liberacao|desbloqueio|alfandega|entrega|saque|cadastro|adesao|transferencia|resgate)', c: 'scam' },
  { p: '(?:paga|pague|pagar|deposita|deposite) (?:a |o |uma |um |esa |ese )?(?:taxa|boleto|fianca) (?:pra|para|por) mim', c: 'scam' },
  { p: '(?:pode|poderia|consegue) (?:me )?pagar (?:a |o |uma |um |esa |ese )?(?:taxa|boleto|fianca)', c: 'scam' },
  // dados de conta / cartão / código (tomada de conta)
  { p: '(?:codigo|cod) (?:de verificacao|de seguranca|de confirmacao|que (?:chegou|recebeu|vai chegar|chegar)|do (?:whatsap|zap|wp|sms))', c: 'scam' },
  { p: '(?:numero|dados|senha|foto) do (?:seu |teu )?(?:cartao|cartao de credito|banco)|(?:sua|tua) senha (?:do|de)', c: 'scam' },
  // "investimento" milagroso
  { p: '(?:lucro|retorno|rendimento|ganho)s? garantid[oa]s?|ganhe dinheiro|opcoes binarias|plataforma de investimento', c: 'scam' },
  { p: 'ganhar dinheiro (?:facil|rapido|em casa|sem sair de casa)', c: 'scam' },
  { p: 'robo (?:de|do) (?:trade|investimento|investimentos|bitcoin|cripto)', c: 'scam' },
  { p: '(?:dobrar|duplicar|multiplicar|triplicar) (?:o |seu |teu |o seu )?dinheiro|(?:invista|investe|investir) (?:comigo|com a gente|na minha)', c: 'scam' },
  // vale-presente / recarga
  { p: '(?:manda|mande|compra|compre|envia|envie|me da|me de|me faz|faz) (?:um |uma )?(?:gift ?card|giftcard|vale presente|cartao presente)', c: 'scam' },
  { p: 'me (?:faz|faca|manda|mande|compra|compre|coloca|bota) (?:uma )?recarga|recarga (?:pra|para) mim', c: 'scam' },
  // venda de conteúdo / programa
  { p: 'vend[oe] (?:meu |meus |minha |minhas |o |os )?(?:pack|packs|nudes?|conteudo|conteudos|calcinha|calcinhas)', c: 'scam' },
  { p: '(?:pack|packs|nudes?|conteudo) (?:a venda|por (?:r )?[0-9]+|por apenas|baratinho)', c: 'scam' },
  { p: 'onlyfans|only fans|fansly|(?:link do|link no|asina o|asine o|asina meu|asine meu|meu) privacy', c: 'scam' },
  { p: '(?:faco|fazemos) programa|garota de programa|garoto de programa|acompanhante de luxo', c: 'scam' },
  { p: '(?:programa|encontro) (?:por|a partir de|custa) (?:r )?[0-9]+', c: 'scam' },
  // no nome e no @: Pix, venda, divulgação
  { p: 'pix|pixs|privacy|divulga|divulgacao', c: 'scam', in: 'handle' },
  // "Vendas" é sobrenome ("Bia Vendas"): no nome só no começo ou com "online"; no @ vale em qualquer lugar
  { p: '^(?:vendas?|vendo)|(?:vendas?|vendo) (?:online|on line)', c: 'scam', in: 'handle' },
  { p: 'vendas?|vendo', c: 'scam', in: 'instagram' },
];

/** encurtadores de link (golpe clássico: esconde o destino). Casam com ponto real ou disfarçado: "bit . ly", "bit(.)ly" */
export const SHORTENER_DOMAINS: readonly string[] = [
  'bit.ly',
  'bitly.com',
  'bit.do',
  'tinyurl.com',
  'cutt.ly',
  'is.gd',
  'v.gd',
  'ow.ly',
  'shorturl.at',
  'rebrand.ly',
  'tiny.cc',
  'rb.gy',
  't.ly',
  'goo.gl',
  'encurtador.com.br',
  'encurta.net',
  'abre.ai',
  'short.io',
  'x.gd',
  'shre.ink',
  'u.to',
  'kutt.it',
  'migre.me',
  'urlzs.com',
  'lnkd.in',
  'tr.im',
  'qr.net',
];

// ─────────────────────────── menor de idade + termo sexual por perto ───────────────────────────
// "novinha de 15 … transar", "tenho 16 anos e quero sexo", "tenho quinze e…". Regra em text-filter.ts: um INDICADOR
// de menor a poucas palavras de um TERMO sexual. Família ("minha filha de 8 anos"), tempo ("faz 2 anos", "tenho 3 anos de casada")
// e cidade/medida ("menina de Sete Lagoas", "menino de dois metros", "garota de Treze Tílias") não contam. Termos com duplo sentido ficam de fora de propósito: pelada (futebol), safada/excitada ("criança
// safada"), gostosa (comida), pack (de fraldas), gozar (zoar), íntima (amiga).

/**
 * número por extenso → dígito, na visão "plain" (idade e valores): "tenho quinze anos" vira "tenho 15 anos". "um/uma"
 * ficam de fora de propósito ("novinha de uma cidade pequena"). Com as grafias erradas mais comuns.
 */
export const SPELLED_NUMBERS: Readonly<Record<string, string>> = {
  dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9', dez: '10',
  onze: '11', doze: '12', treze: '13', trese: '13', catorze: '14', quatorze: '14', catorse: '14', quatorse: '14',
  quinze: '15', quinse: '15', dezeseis: '16', deseseis: '16', dezaseis: '16', dezesete: '17', desesete: '17',
  dezasete: '17',
};

/** termos sexuais (palavra inteira, texto normalizado) */
export const MINOR_SEXUAL_WORDS: readonly string[] = [
  'sexo', 'sexual', 'sexuais', 'transar', 'transa', 'transo', 'transou', 'transamos', 'transando', 'transaria',
  'foder', 'fuder', 'fode', 'fodo', 'fudo', 'nudes', 'putaria', 'punheta', 'siririca', 'tesao', 'tesuda', 'tesudo',
  'boquete', 'buceta', 'boceta', 'xoxota', 'xereca', 'piroca', 'sensual', 'sensuais', 'porno', 'pornografia',
  'erotica', 'erotico',
];

/**
 * indicadores de menor por si sós (janela curta). "criança" NÃO entra aqui: "Amo crianças. Sexo casual não." é bio
 * comum — criança só conta nos padrões explícitos do LEXICON ("sexo com criança", "criança pelada", "nudes de criança")
 */
export const MINOR_WORDS: readonly string[] = ['ninfeta', 'ninfetas', 'ninfetinha', 'preadolescente', 'preadolescentes'];

/** indicadores de duas palavras */
export const MINOR_PHRASES: readonly string[] = [
  'menor de idade', 'menores de idade', 'de menor', 'uma menor', 'um menor', 'com menor', 'pre adolescente',
];

/**
 * série escolar: só conta com a PESSOA sendo da série ("sou do ensino fundamental", "tô na oitava série",
 * "menina da quinta série"), não "sou professora do ensino fundamental". "tenho ensino fundamental" é escolaridade
 * de adulto, por isso "tenho" não entra.
 */
export const MINOR_SCHOOL_PHRASES: readonly string[] = [
  'ensino fundamental', 'quinta serie', 'sexta serie', 'setima serie', 'oitava serie',
];

/** quem diz que ESTÁ na série (antes da série, com "no/na/do/da/o/a/ainda" no meio) */
export const MINOR_SCHOOL_SELF: readonly string[] = [
  'sou', 'estou', 'to', 'tou', 'ta', 'esta', 'tava', 'estava', 'estudo', 'estuda', 'estudando', 'estudante',
  'curso', 'cursa', 'cursando', 'faco', 'faz', 'fazendo', 'frequento', 'frequenta', 'terminando', 'aluno', 'aluna',
  'alunos', 'alunas',
];

/** quem pode ser a pessoa da idade: "menina de 14", "novinha 15", "ela tem 16" */
export const MINOR_PERSON_WORDS: readonly string[] = [
  'menina', 'meninas', 'menino', 'meninos', 'garota', 'garotas', 'garoto', 'garotos', 'novinha', 'novinhas',
  'novinho', 'novinhos', 'novinhinha', 'mina', 'minas', 'mino', 'guria', 'gurias', 'guri', 'moleca', 'molecas',
  'moleque', 'adolescente', 'adolescentes', 'ninfeta', 'gatinha', 'ninfetinha',
];

/** pronomes: só contam com "tem" + idade ("ela tem 16 anos", "ela tem 16 e quer…") */
export const MINOR_PRONOUNS: readonly string[] = ['ela', 'ele'];

/**
 * verbos de idade da própria pessoa: "tenho 16 anos", "fiz 15 anos", "vou fazer 17 anos". Sem "anos" só vale de 10 a
 * 17 e com a frase seguindo ("tenho 17 e quero…", ver MINOR_AGE_BARE_NEXT), nunca "tenho 2 filhos"
 */
export const MINOR_AGE_VERBS: readonly string[] = [
  'tenho', 'tens', 'fiz', 'fez', 'fazer', 'completei', 'completo', 'completa', 'completou', 'completar',
];

/**
 * o que pode vir logo depois de "tenho 16" (sem "anos") pra contar como idade; fim do texto também conta. "fiz 17
 * ontem", "tenho 17 hj", "tenho 17 ainda mas…", "fiz 17 mês passado". Substantivo ("tenho 17 filhos", "fiz 17 reais",
 * "tenho 15 minutos") nunca entra aqui.
 */
export const MINOR_AGE_BARE_NEXT: readonly string[] = [
  'e', 'mas', 'so', 'ja', 'ne', 'quero', 'queria', 'to', 'tou', 'estou', 'sou', 'nao', 'amanha', 'hoje', 'hj',
  'ontem', 'agora', 'agr', 'ainda', 'afim', 'mes', 'semana', 'porem', 'entao', 'k',
];

/**
 * "menina/novinha de N" (e "novinha N") com N de DOIS a NOVE por extenso só vira idade com "anos", fim do texto,
 * MINOR_AGE_BARE_NEXT, termo sexual ou uma destas logo depois ("novinha de sete procurando…"); sem isso é nome de
 * cidade ("Garota de Três Pontas", "Sete Lagoas") ou medida ("dois metros"). Com N de DEZ a DEZESSETE por extenso, ou
 * em dígito, é idade por padrão: só MINOR_AGE_UNDO_NEXT desfaz ("Treze Tílias", "Quinze de Novembro", "15 minutos").
 */
export const MINOR_PERSON_AGE_NEXT: readonly string[] = [
  'querendo', 'procurando', 'quer', 'procura', 'busca', 'buscando', 'topa', 'topando', 'aqui', 'safada', 'safado',
  'safadinha', 'safadinho', 'gostosa', 'gostoso', 'gostosinha', 'gostosinho', 'tarada', 'tarado', 'virgem', 'carente',
  'sozinha', 'sozinho', 'solteira', 'solteiro', 'novinha', 'novinho',
];

/** família / bicho / coisa antes da idade: não é alguém sendo sexualizado ("minha filha de 8 anos") */
export const MINOR_FAMILY_WORDS: readonly string[] = [
  'filho', 'filha', 'filhos', 'filhas', 'sobrinho', 'sobrinha', 'sobrinhos', 'sobrinhas', 'neto', 'neta', 'netos',
  'netas', 'enteado', 'enteada', 'enteados', 'enteadas', 'afilhado', 'afilhada', 'irmao', 'irma', 'irmaos', 'irmas',
  'primo', 'prima', 'primos', 'primas', 'bebe', 'bebes', 'cachoro', 'cachora', 'gato', 'gata', 'caro', 'casa',
];

/**
 * logo depois de "N anos" indica tempo, não idade ("2 anos de casada", "3 anos que", "5 anos sem"). Exceção: "N anos
 * DE IDADE" é idade (text-filter.ts)
 */
export const MINOR_AGE_NOT_AFTER: readonly string[] = [
  'de', 'que', 'sem', 'atras', 'depois', 'antes', 'juntos', 'juntas', 'casada', 'casado', 'namorando', 'desde', 'no',
  'na', 'em', 'nese', 'nesa',
];

/** pedaços no @ (colado: "joaocaralho"): só termos longos e inequívocos */
export const HANDLE_SUBSTRINGS: readonly { s: string; c: TextBlockReason }[] = [
  { s: 'caralh', c: 'profanity' },
  { s: 'arombad', c: 'profanity' },
  { s: 'filhodaputa', c: 'profanity' },
  { s: 'fodase', c: 'profanity' },
  { s: 'bucet', c: 'sexual' },
  { s: 'bocet', c: 'sexual' },
  { s: 'piroca', c: 'sexual' },
  { s: 'putari', c: 'sexual' },
  { s: 'xerec', c: 'sexual' },
  { s: 'xoxot', c: 'sexual' },
  { s: 'punhet', c: 'sexual' },
  { s: 'boquet', c: 'sexual' },
  { s: 'travec', c: 'hate' },
  { s: 'boiola', c: 'hate' },
  { s: 'baitola', c: 'hate' },
  { s: 'onlyfans', c: 'scam' },
  { s: 'vendopack', c: 'scam' },
];

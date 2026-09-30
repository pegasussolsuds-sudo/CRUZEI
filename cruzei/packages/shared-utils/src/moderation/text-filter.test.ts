import type { TextField } from '@cruzei/shared-types';

import {
  ALLOWLIST,
  HANDLE_SUBSTRINGS,
  LEXICON,
  MACROS,
  MINOR_AGE_BARE_NEXT,
  MINOR_AGE_NOT_AFTER,
  MINOR_AGE_UNDO_NEXT,
  MINOR_AGE_VERBS,
  MINOR_COMPARATIVE_AFTER,
  MINOR_FAMILY_WORDS,
  MINOR_PERSON_AGE_NEXT,
  MINOR_PERSON_WORDS,
  MINOR_PHRASES,
  MINOR_SCHOOL_PHRASES,
  MINOR_SCHOOL_SELF,
  MINOR_SEXUAL_WORDS,
  MINOR_WORDS,
  RR_MACROS,
  SPELLED_NUMBERS,
} from './lexicon';
import { normalizeForFilter, normalizeText } from './normalize';
import {
  checkProfileText,
  checkText,
  expandMacros,
  findAbuse,
  spelledNumbersToDigits,
  textBlockedError,
} from './text-filter';

const ZWSP = String.fromCharCode(0x200b);
const CYR_A = String.fromCharCode(0x430);

const verdict = (text: string, field: TextField) => {
  const v = checkText(text, field);
  return v.action === 'allow' ? 'allow' : `${v.action}:${v.reason}`;
};

describe('normalização', () => {
  it.each([
    ['V14D0!!!', 'viado'],
    ['p.u.t.a', 'puta'],
    ['p-u-t-a', 'puta'],
    ['viaaaaado', 'viado'],
    ['v i a d o', 'viado'],
    ['V I A A D O', 'viado'],
    ['Você é LINDA', 'voce e linda'],
    [`vi${ZWSP}ado`, 'viado'],
    [`vi${CYR_A}do`, 'viado'],
    ['put@', 'puta'],
    ['$exo', 'sexo'],
    ['p0rr4', 'pora'],
    ['@joao', 'joao'],
    ['m3rd4, c4r4lh0', 'merda caralho'],
    ['Não, obrigada.', 'nao obrigada'],
  ])('%s → %s', (input, out) => {
    expect(normalizeText(input)).toBe(out);
  });

  it('número sozinho fica; número colado em letra vira letra na visão leet e se separa na plain', () => {
    expect(normalizeForFilter('tenho 15 anos').leet).toBe('tenho 15 anos');
    expect(normalizeForFilter('novinha15').plain).toBe('novinha 15');
    expect(normalizeForFilter('viado123').plain).toBe('viado 123');
    expect(normalizeForFilter('11 anos').plain).toBe('11 anos');
    expect(normalizeForFilter('R$ 50').plain).toBe('r 50');
  });

  it('duas letras soltas não juntam (só 3+): "é o fim" continua', () => {
    expect(normalizeText('é o fim')).toBe('e o fim');
  });

  it('visão rr: normaliza igual à leet, mas "rr" fica ("morra" ≠ "mora")', () => {
    const rr = (s: string) => normalizeForFilter(s).rr;
    expect(rr('morra viado')).toBe('morra viado');
    expect(rr('mora gay nesse prédio')).toBe('mora gay nese predio');
    expect(rr('MORRRRA viaaaado')).toBe('morra viado');
    expect(rr('moooorrrer')).toBe('morrer');
    expect(rr('m0rr4 v14d0')).toBe('morra viado');
    expect(rr('m.o.r.r.a')).toBe('morra');
    expect(rr('m o r r a')).toBe('morra');
    expect(rr('Mórre, sapatão!')).toBe('morre sapatao');
    // a leet continua colapsando tudo
    expect(normalizeForFilter('morra viado').leet).toBe('mora viado');
  });
});

describe('listas (lexicon.ts) — regras de escrita', () => {
  const expand = (entries: typeof LEXICON) => [
    ...entries.map((e) => expandMacros(e.p, e.rr)),
    ...entries.filter((e) => e.notAfter).map((e) => expandMacros(e.notAfter ?? '', e.rr)),
  ];
  const sources = expand(LEXICON.filter((e) => !e.rr));
  const rrSources = expand(LEXICON.filter((e) => e.rr));

  it('todo padrão compila', () => {
    for (const s of [...sources, ...rrSources]) expect(() => new RegExp(s)).not.toThrow();
  });

  it('sem letra dobrada, sem maiúscula e sem acento (o texto chega normalizado)', () => {
    for (const s of [...sources, ...Object.values(MACROS)]) {
      expect(s).not.toMatch(/([a-z])\1/);
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).not.toMatch(/[^\x00-\x7f]/);
    }
  });

  it('padrão rr: só "rr" pode vir dobrado (nunca "rrr" nem outra letra) e ele tem de usar o "rr"', () => {
    expect(rrSources.length).toBeGreaterThan(0);
    for (const s of [...rrSources, ...Object.values(RR_MACROS)]) {
      expect(s.replace(/rr/g, 'r')).not.toMatch(/([a-z])\1/);
      expect(s).not.toMatch(/rrr/);
      expect(s).not.toMatch(/[A-Z]/);
      expect(s).not.toMatch(/[^\x00-\x7f]/);
    }
    for (const e of LEXICON.filter((x) => x.rr)) expect(expandMacros(e.p, true)).toMatch(/rr/);
  });

  it('atalho desconhecido é erro; {morrer} fora de padrão rr também', () => {
    expect(() => expandMacros('{nao_existe} x')).toThrow(/atalho desconhecido/);
    expect(() => expandMacros('{constructor} x')).toThrow(/atalho desconhecido/);
    expect(() => expandMacros('{morrer} {lgbt}')).toThrow(/rr: true/);
    expect(expandMacros('{morrer}', true)).toMatch(/morra/);
  });

  it('listas de palavra já normalizadas', () => {
    const words = [
      ...ALLOWLIST,
      ...MINOR_SEXUAL_WORDS,
      ...MINOR_WORDS,
      ...MINOR_PHRASES,
      ...MINOR_SCHOOL_PHRASES,
      ...MINOR_SCHOOL_SELF,
      ...MINOR_COMPARATIVE_AFTER,
      ...MINOR_PERSON_WORDS,
      ...MINOR_AGE_VERBS,
      ...MINOR_AGE_BARE_NEXT,
      ...MINOR_FAMILY_WORDS,
      ...MINOR_AGE_NOT_AFTER,
      ...MINOR_AGE_UNDO_NEXT,
      ...MINOR_PERSON_AGE_NEXT,
      ...Object.keys(SPELLED_NUMBERS),
      ...HANDLE_SUBSTRINGS.map((h) => h.s),
    ];
    for (const w of words) expect(normalizeText(w)).toBe(w);
  });

  it('o que confirma idade nunca está no que desfaz idade', () => {
    const undo = new Set(MINOR_AGE_UNDO_NEXT);
    for (const w of [...MINOR_AGE_BARE_NEXT, ...MINOR_PERSON_AGE_NEXT, ...MINOR_SEXUAL_WORDS]) {
      expect(undo.has(w)).toBe(false);
    }
  });
});

describe('mensagem — bloqueia o grave', () => {
  it.each([
    // ameaça
    ['vou te matar', 'threat'],
    ['Vou te m4t4r sua vadia', 'threat'],
    ['eu te mato se contar', 'threat'],
    ['sei onde vc mora', 'threat'],
    ['Sei onde você trabalha, cuidado', 'threat'],
    ['se não me pagar eu vou vazar suas fotos', 'threat'],
    ['vou espalhar suas nudes pra todo mundo', 'threat'],
    ['vou te expor', 'threat'],
    ['vou te encher de porrada', 'threat'],
    ['vou te dar um tiro', 'threat'],
    ['vc vai morrer', 'threat'],
    ['espero que vc morra', 'threat'],
    ['morre logo', 'threat'],
    ['vai se matar', 'threat'],
    ['vou te estuprar', 'threat'],
    ['vou te dar uma surra', 'threat'],
    ['vou te dar uma surra de cinto', 'threat'],
    ['vou te dar uma surra no meio da rua', 'threat'],
    ['te arrebento', 'threat'],
    ['vou te estuprar de amor', 'threat'],
    ['vou te matar de novo', 'threat'],
    ['vou te matar de vez', 'threat'],
    // ódio
    ['seu macaco', 'hate'],
    ['vc é um macaco', 'hate'],
    ['volta pra senzala', 'hate'],
    ['gay tem que morrer', 'hate'],
    ['gays tinham que morrer', 'hate'],
    ['sua sapatão nojenta', 'hate'],
    ['viado nojento', 'hate'],
    ['v1ad0 n0j3nt0', 'hate'],
    ['v.i.a.d.o nojento', 'hate'],
    ['seu viado', 'hate'],
    ['traveco', 'hate'],
    ['odeio gays', 'hate'],
    ['negro imundo', 'hate'],
    ['nordestino lixo', 'hate'],
    ['morte aos gays', 'hate'],
    ['trans é doença', 'hate'],
    ['heil hitler', 'hate'],
    ['gays são doentes', 'hate'],
    ['negros são inferiores', 'hate'],
    ['mata a bicha', 'hate'],
    ['matar o viado', 'hate'],
    ['acabar com os pretos', 'hate'],
    ['morre viado', 'hate'],
    ['morra, bicha!', 'hate'],
    ['morre sapatão', 'hate'],
    ['cala a boca e morre viado', 'hate'],
    ['tu morre viado kkk, morre viado', 'hate'],
    // "morra" (vira "mora", igual a morar): no começo ou depois de e/vai/então/tomara que…
    ['morra viado', 'hate'],
    ['Morra, sapatão', 'hate'],
    ['cala a boca e morra, viado', 'hate'],
    ['vai morra viado', 'hate'],
    ['então morra, bicha', 'hate'],
    ['tomara que morra viado', 'hate'],
    ['espero que morra bicha', 'hate'],
    ['morra viado no inferno', 'hate'],
    ['que morra, travesti', 'hate'],
    // "morre" (de morrer) em qualquer lugar
    ['sai daqui, morre viado', 'hate'],
    ['aqui no prédio morre viado', 'hate'],
    // MORRER (visão com "rr") + grupo em QUALQUER posição, sem adivinhar pelo que vem antes ou depois
    ['lixo, morra viado', 'hate'],
    ['sai daqui morra viado', 'hate'],
    ['vsf morra bicha', 'hate'],
    ['morra viado aqui', 'hate'],
    ['e morra viado sozinho', 'hate'],
    ['tomara que morra viado', 'hate'],
    ['morre viado', 'hate'],
    ['cala a boca e morra viado', 'hate'],
    ['morram gays', 'hate'],
    ['espero que vc morra de câncer', 'threat'],
    ['espero que vc morra de covid', 'threat'],
    ['vc vai morrer de câncer', 'threat'],
    ['vou te matar de porrada', 'threat'],
    // disfarce: letra repetida, leetspeak, pontinho, espaço
    ['MORRRRA VIAAAADO', 'hate'],
    ['m0rr4 v14d0', 'hate'],
    ['m.o.r.r.a bicha', 'hate'],
    ['m o r r a viado', 'hate'],
    ['moooorra sapatão', 'hate'],
    // ameaça com MORRER também é na visão com "rr"
    ['tomara que vc morra', 'threat'],
    ['quero que você morre', 'threat'],
    ['espero que tu se mate', 'threat'],
    ['morra logo', 'threat'],
    // sexual envolvendo menor
    ['manda nudes de novinha de 15', 'minor'],
    ['tenho 15 anos e quero transar', 'minor'],
    ['sou novinha 16 anos quer sexo?', 'minor'],
    ['menina de 14 anos pelada', 'minor'],
    ['sexo com criança', 'minor'],
    ['foto pelada de criança', 'minor'],
    ['criança sem roupa', 'minor'],
    ['tenho tesão por novinha de 13', 'minor'],
    ['pornografia infantil', 'minor'],
    ['ela tem 16 anos e faz sexo', 'minor'],
    ['menor de idade transando', 'minor'],
    ['ela é de menor mas topa sexo', 'minor'],
    ['vendo pack de menor', 'minor'],
    // idade sem "anos" e por extenso
    ['tenho 17 e quero transar', 'minor'],
    ['quero transar, tenho 16', 'minor'],
    ['ela tem 16 e quer transar', 'minor'],
    ['tenho quinze anos e quero sexo', 'minor'],
    ['tenho dezessete e quero sexo', 'minor'],
    ['tenho catorze anos, quero transar', 'minor'],
    ['tenho quatorze e topo sexo', 'minor'],
    ['novinha de quinze afim de transar', 'minor'],
    ['manda nudes de novinha de quinze', 'minor'],
    ['menina de oito anos pelada', 'minor'],
    // "menina/novinha de N": com o que vem depois confirmando idade
    ['novinha de quinze a fim de transar', 'minor'],
    ['menina de quinze querendo sexo', 'minor'],
    ['garota de dezesseis quer transar', 'minor'],
    ['menina de 14 procurando sexo', 'minor'],
    ['novinha de 15 gatinha quer sexo', 'minor'],
    ['novinha de 15, sexo?', 'minor'],
    ['tenho tesão por novinha de quinze', 'minor'],
    // DEZ a DEZESSETE por extenso depois de menina/garota/novinha…: idade por padrão (como dígito)
    ['menina de quinze gosta de sexo', 'minor'],
    ['garota de treze adora sexo', 'minor'],
    ['novinha de dezesseis curte sexo', 'minor'],
    ['sou menina de quinze, vamos transar?', 'minor'],
    ['sou garota de dezesseis, bora transar?', 'minor'],
    ['novinha de quinze pra transar', 'minor'],
    ['novinha de quinze doida pra transar', 'minor'],
    ['menina de quatorze louca por sexo', 'minor'],
    ['menino de quinze que curte sexo', 'minor'],
    ['menina de quinze vem transar comigo', 'minor'],
    ['novinha de quatorze bem safadinha quer transar', 'minor'],
    ['garota de dez adora sexo', 'minor'],
    ['mina de onze curte sexo', 'minor'],
    ['menino de doze gosta de sexo', 'minor'],
    ['garoto de catorze curte sexo', 'minor'],
    ['menina de dezessete doida pra transar', 'minor'],
    ['menina de 15 gosta de sexo', 'minor'],
    // "N anos de idade" é idade (o "de" não vira tempo)
    ['tenho 16 anos de idade e quero transar', 'minor'],
    ['sou novinha de 16 anos de idade e quero sexo', 'minor'],
    ['tenho quinze anos de idade quero sexo', 'minor'],
    ['tenho 16 anos de idade e eu quero muito transar', 'minor'],
    // idade sem "anos" com hj/ontem/ainda/agr/afim/mês/semana depois
    ['fiz 17 ontem e quero transar', 'minor'],
    ['tenho 17 hj e quero transar', 'minor'],
    ['tenho 17 ainda mas quero transar', 'minor'],
    ['tenho 16 agr e quero sexo', 'minor'],
    ['tenho 15 afim de sexo', 'minor'],
    ['fiz 17 mês passado e quero transar', 'minor'],
    ['fiz 16 semana passada, bora transar', 'minor'],
    // série escolar da própria pessoa
    ['sou do ensino fundamental e quero sexo', 'minor'],
    ['tô no ensino fundamental e quero transar', 'minor'],
    ['ainda to no ensino fundamental mas topo sexo', 'minor'],
    ['sou aluna da oitava série e quero transar', 'minor'],
    ['menina da quinta série quer sexo', 'minor'],
    // "menor" de idade (não comparação)
    ['quero sexo com uma menor de idade', 'minor'],
    ['quero transar com menor', 'minor'],
    ['tesão por menor', 'minor'],
  ])('%s → %s', (text, reason) => {
    const v = checkText(text, 'message');
    expect(v.action).toBe('block');
    expect(v.reason).toBe(reason);
    expect(v.message).toMatch(/^Essa mensagem fere as regras do Metch/);
  });

  it('golpe junto com ódio: bloqueia (o grave vence)', () => {
    expect(verdict('me manda um pix seu macaco', 'message')).toBe('block:hate');
  });
});

describe('mensagem — golpe passa e vira denúncia (flag)', () => {
  it.each([
    'me manda um pix de 50',
    'me faz um pix?',
    'Me manda um p1x rapidinho',
    'minha chave pix é 11999998888',
    'manda um pix pra mim',
    'clica aqui bit.ly/abc123',
    'https://bit.ly/3xYz',
    'entra no bit . ly / promo',
    'tinyurl.com/golpe',
    'me passa o código que chegou no seu celular',
    'me manda o código de verificação',
    'lucro garantido em 24h',
    'opções binárias',
    'vendo pack baratinho',
    'meu onlyfans',
    'preciso de 200 reais pro aluguel',
    'to precisando de uma ajuda financeira',
    'me empresta 100?',
    'paga a taxa de liberação',
    'me compra um gift card',
    'faço programa, 200 a hora',
    'programa por 150',
  ])('%s', (text) => {
    const v = checkText(text, 'message');
    expect(v.action).toBe('flag');
    expect(v.reason).toBe('scam');
    expect(v.message).toBeNull();
    expect(v.match).toBeTruthy();
  });
});

describe('mensagem — conversa normal passa (falsos positivos comuns)', () => {
  it.each([
    'oi, tudo bem?',
    'vou te matar de saudade',
    'te mato de beijo',
    'vc vai morrer de rir com isso',
    'manda bala!',
    'quer uma bala de menta?',
    'vou te pegar às 8',
    'vou te sequestrar pra jantar hoje',
    'esse calor vai te matar kkk',
    'ela mora logo ali',
    'espero que vc more perto de mim',
    'bora jogar uma pelada com as crianças no domingo',
    'minha filha de 8 anos adora dançar',
    'tenho uma filha de 7 anos e não quero sexo casual',
    'faz 2 anos que não transo',
    'tenho 3 anos de casada e o sexo acabou',
    'tenho 17 anos',
    'Amo crianças. Sexo casual não.',
    'comida gostosa pras crianças',
    'que criança safada, pegou meu doce',
    'chá revelação: sexo do bebê é menino!',
    'vou pagar o boleto amanhã',
    'rachamos a conta, depois te mando o valor',
    'me passa seu número do zap?',
    'comi um cuscuz em Sucupira',
    'moro em Ponta Porã',
    'o pica-pau é o melhor desenho',
    'comprei uma calça preta suja',
    'vi um macaco no zoológico',
    'esse macaco é muito fofo',
    'sou gay e feliz',
    'e aí viado, sdds',
    'porra, que dia foda',
    'caralho kkkk',
    'vai tomar no cu kkkk',
    'que bunda gostosa',
    'quero transar com vc',
    'bicha preta sim',
    'minha amiga é trans',
    'vou postar uma foto do rolê',
    'vou vazar daqui, tchau',
    'vou expor meu trabalho na galeria',
    'vou quebrar a cara nessa prova',
    'vou furar a orelha',
    'educação sexual nas escolas é importante',
    'sou nordestino com orgulho',
    'amo a cultura judaica',
    // doença/inferior colado no grupo não é xingamento ("gay é doente" continua pego)
    'meu amigo gay doente em casa',
    'tô com uma amiga trans doente',
    'o negro doente foi atendido primeiro',
    // carinho e jogo
    'vou te dar uma surra de beijo',
    'vou te dar uma surra no truco',
    'vou te arrebentar de beijo',
    'te arrebento no fifa',
    'vou te bater no videogame',
    'te mato de vez em quando de cócegas',
    // série escolar de quem não é aluno
    'sou professora do ensino fundamental e adoro sexo',
    'dou aula pra quinta série e adoro sexo',
    'tenho ensino fundamental completo e adoro sexo',
    // "menor" comparação
    'transo com menor frequência hoje em dia',
    'sexo de menor risco',
    'faço sexo com menores riscos',
    // idade: tempo, família, contagem
    'tenho 17 anos de casada e o sexo ainda é bom',
    'tenho 17 de casada e o sexo é ótimo',
    'faz quinze minutos que cheguei, bora transar?',
    'minha filha de quinze anos passou no vestibular',
    'minha filha de quinze anos perguntou sobre sexo',
    'tenho 2 e quero mais sexo',
    'tenho 2 filhos e o sexo acabou',
    'fiz 15 minutos de esteira e depois sexo',
    'novinha de uma cidade pequena, quero sexo',
    // bicha (verme), preta (cerveja), orgulho e vocativo
    'remédio pra matar a bicha',
    'vamos acabar com a preta que sobrou na geladeira',
    'quem nasce gay morre gay',
    'nasceu gay e morre gay',
    'nasci gay e vou morrer gay',
    'tu morre viado kkkk',
    'se eu te contar vc morre viado',
    // "mora" = verbo morar (não "morra")
    'aqui no prédio mora gay e hétero, todo mundo em paz',
    'no meu prédio mora trans e ninguém liga',
    'na minha rua mora travesti',
    'lá mora gay, lá mora hétero',
    'lá mora hétero e mora gay',
    'onde eu moro mora travesti também',
    'mora trans no meu prédio e ninguém liga',
    'Mora gay e hétero aqui, todo mundo em paz',
    'eu moro com um amigo gay e mora trans no andar de cima',
    // MORAR ("mora", um r) nunca é MORRER, em qualquer posição e com qualquer coisa depois
    'mora gay nesse prédio?',
    'mora trans por aqui?',
    'mora gay também',
    'mora gay comigo',
    'mora travesti do outro lado da rua',
    'aqui no prédio mora gay e hétero',
    'lá mora gay, lá mora hétero',
    'mora gay',
    'e mora gay aqui do lado',
    'tomara que mora gay no prédio novo, a gente faz amizade',
    'ela mora logo ali, vou lá',
    'espero que vc more perto de mim',
    // MORRER sem ser contra o grupo: sujeito, vocativo, orgulho, expressão
    'tô morrendo, viado kkkk',
    'vou morrer gay e feliz',
    'não tenho medo de morrer gay',
    'meu sonho é morrer gay e feliz',
    'melhor morrer gay que viver mentindo',
    'e daí? morrer gay é melhor que viver no armário',
    'meu tio morreu gay, orgulho dele',
    'vou te matar de beijo',
    'espero que vc morra de velhice do meu lado',
    'quero morrer gay',
    'ele morreu gay e feliz',
    'ele vai morrer gay, e daí?',
    'a gente vai morrer gay e feliz',
    'espero que vc morra de rir',
    'quero que vc morra comigo, bem velhinhos',
    'não quero que vc morra, se cuida',
    'eu nunca espero que você morra',
    'o personagem morre logo depois',
    // "menina de N" que é cidade, medida ou altura
    'sou menina de Sete Lagoas e curto sexo casual',
    'mina de Dois Irmãos procurando sexo',
    'menino de dois metros de altura, bom de sexo',
    'menina de 3 Lagoas e curto sexo',
    'menino de 1,90, bom de sexo',
    'garota de Três Pontas procurando sexo casual',
    'tenho tesão por novinha de Três Corações',
    'manda nudes de novinha de Sete Lagoas',
    'Menina de Três Lagoas, adoro sexo e vinho',
    'garota de Três Corações, sensual e divertida',
    'Garoto de Quatro Barras. Sexo? só com amor',
    'garota de Treze Tílias adora sexo',
    'menina de Quinze de Novembro curte sexo',
    'garota de Treze de Maio curte sexo',
    'menina de Sete de Setembro adora sexo',
    'novinha de quinze minutos atrás, bora transar',
    'menino de treze metros de altura, bom de sexo',
    'garota de dezesseis mil seguidores, sensual',
    'menina de sete irmãos curte sexo',
    'garota com quinze tatuagens e adora sexo',
    // "anos de" que é tempo continua tempo
    'tenho 17 anos de casada',
    'tenho 17 anos de idade',
    // número seguido de substantivo não é idade
    'tenho 17 filhos e ainda adoro sexo',
    'fiz 17 reais hoje, bora transar',
    'tenho 15 minutos agora, bora transar?',
  ])('%s', (text) => {
    expect(verdict(text, 'message')).toBe('allow');
  });
});

describe('nome', () => {
  it.each([
    'Maria',
    'Ana Pinto',
    'João Cunha',
    'Cássia',
    'Sucupira',
    'Cuscuz',
    'Anna Clara',
    'Bichara',
    'Viana',
    'Kuka',
    'Pedro Rola',
    'José da Silva',
    'Cunhaporã',
    'Negão',
    'Bia Vendas',
  ])('%s passa', (name) => {
    expect(verdict(name, 'name')).toBe('allow');
  });

  it.each([
    ['Puta', 'profanity'],
    ['P0rr4', 'profanity'],
    ['fdp', 'profanity'],
    ['Viado', 'hate'],
    ['Sapatão', 'hate'],
    ['Traveco', 'hate'],
    ['Maria Pix', 'scam'],
    ['Buceta', 'sexual'],
    ['Nudes', 'sexual'],
    ['Ana bit.ly/x', 'scam'],
    ['Vendas da Bia', 'scam'],
    ['Bia Vendas Online', 'scam'],
    ['Vendo Roupas', 'scam'],
    ['Piranha', 'profanity'],
  ])('%s → %s', (name, reason) => {
    const v = checkText(name, 'name');
    expect(v.action).toBe('block');
    expect(v.reason).toBe(reason);
    expect(v.message).toMatch(/nome/i);
  });
});

describe('bio', () => {
  it.each([
    'Amo viajar, cuscuz e praia 🌊',
    'Sou de Sucupira',
    'Adoro crianças. Sexo casual não.',
    'Não mando nudes, nem adianta pedir',
    'Sapatão com orgulho 🏳️‍🌈',
    'Bicha preta e feliz',
    'Moro em Ponta Porã',
    'Odeio gente falsa',
    'Não peço pix nem dinheiro, cuidado com golpe',
    'Pai de dois, filha de 7 e filho de 10',
    'Fã do Pica-Pau',
    'Pescador de piranha',
    'Pescador de piranhas no Pantanal',
    'Amo pesca de piranha no rio',
    'Uso piranha de cabelo todo dia',
    // cidade com número no nome não é idade
    'Menina de Três Lagoas, adoro sexo e vinho',
    'garota de Três Corações, sensual e divertida',
    'Garoto de Quatro Barras. Sexo? só com amor',
    'Menina de Treze Tílias, sexo só com conexão',
    'garota de Treze Tílias adora sexo',
    'Menina de Quinze de Novembro, curto sexo casual',
    // morar
    'No meu prédio mora gay, hétero, todo mundo',
    'Na minha rua mora travesti e é todo mundo amigo',
  ])('%s passa', (bio) => {
    expect(verdict(bio, 'bio')).toBe('allow');
  });

  it.each([
    ['Vendo pack, chama', 'scam'],
    ['meu onlyfans no link', 'scam'],
    ['Pix: 11999998888', 'scam'],
    ['chave pix na dm', 'scam'],
    ['bit.ly/meulink', 'scam'],
    ['vai tomar no cu', 'profanity'],
    ['sou foda', 'profanity'],
    ['p u t a', 'profanity'],
    ['buceta', 'sexual'],
    ['putaria liberada', 'sexual'],
    ['odeio viado', 'hate'],
    ['sei onde vc mora', 'threat'],
    ['ninfeta', 'minor'],
    ['sou piranha mesmo', 'profanity'],
    ['menina de 15 anos de idade, adoro sexo', 'minor'],
    ['novinha de quinze afim de sexo', 'minor'],
    ['morra viado', 'hate'],
    ['lixo, morra viado', 'hate'],
    ['menina de quinze, adoro sexo', 'minor'],
  ])('%s → %s', (bio, reason) => {
    const v = checkText(bio, 'bio');
    expect(v.action).toBe('block');
    expect(v.reason).toBe(reason);
    expect(v.message).toMatch(/bio/i);
  });
});

describe('@ do Instagram', () => {
  it.each(['joao.silva', 'maria_1995', 'cuscuzeiro', 'pixbet', 'j0a0', 'ana.sucupira', 'pintoana'])('%s passa', (h) => {
    expect(verdict(h, 'instagram')).toBe('allow');
  });

  it.each([
    ['joao.pix', 'scam'],
    ['viado_123', 'hate'],
    ['caralhudo', 'sexual'],
    ['joaocaralho', 'profanity'],
    ['onlyfans.maria', 'scam'],
    ['maria.onlyfans', 'scam'],
    ['putaria.br', 'sexual'],
    ['vendas.store', 'scam'],
    ['put4_', 'profanity'],
    ['maria.vendas', 'scam'],
  ])('%s → %s', (h, reason) => {
    const v = checkText(h, 'instagram');
    expect(v.action).toBe('block');
    expect(v.reason).toBe(reason);
    expect(v.message).toMatch(/@/);
  });
});

describe('ajudantes', () => {
  it('vazio passa', () => {
    expect(checkText('', 'message').action).toBe('allow');
    expect(checkText(null, 'bio').action).toBe('allow');
    expect(findAbuse('   ', 'name')).toEqual([]);
  });

  it('textBlockedError monta o corpo do 400', () => {
    const v = checkText('Puta', 'name');
    expect(textBlockedError('name', v)).toEqual({
      error: 'text_blocked',
      message: v.message,
      field: 'name',
      reason: 'profanity',
    });
  });

  it('checkProfileText devolve o 1º campo recusado', () => {
    expect(checkProfileText({ name: 'Maria', bio: 'Amo praia', instagram: 'maria.silva' })).toBeNull();
    expect(checkProfileText({ name: 'Maria', bio: 'vendo pack', instagram: 'viado' })).toMatchObject({
      error: 'text_blocked',
      field: 'bio',
      reason: 'scam',
    });
    expect(checkProfileText({ name: 'Maria', instagram: 'joao.pix' })?.field).toBe('instagram');
  });

  it('número por extenso vira dígito (palavra inteira; "um/uma" e protótipo ficam)', () => {
    expect(spelledNumbersToDigits('tenho quinze anos')).toBe('tenho 15 anos');
    expect(spelledNumbersToDigits('dezeseis dezesete catorze quatorze')).toBe('16 17 14 14');
    expect(spelledNumbersToDigits('novinha de uma cidade')).toBe('novinha de uma cidade');
    expect(spelledNumbersToDigits('quinzena constructor tostring')).toBe('quinzena constructor tostring');
  });

  it('número por extenso só vale pra idade: valor de golpe continua como veio', () => {
    expect(verdict('me empresta dez reais?', 'message')).toBe('allow');
    expect(verdict('me empresta 10 reais?', 'message')).toBe('flag:scam');
  });

  it('notAfter: o achado cancelado não esconde um 2º trecho mais adiante', () => {
    expect(findAbuse('tu morre viado', 'message')).toEqual([]);
    // (o trecho vem da visão com "rr": "morre", não "more")
    expect(findAbuse('tu morre viado kkk, morre viado', 'message')).toEqual([{ reason: 'hate', match: 'morre viado' }]);
  });

  it('texto enorme não trava (só o começo é analisado)', () => {
    const big = 'bom dia '.repeat(2000) + 'vou te matar';
    const t0 = Date.now();
    expect(checkText(big, 'message').action).toBe('allow');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

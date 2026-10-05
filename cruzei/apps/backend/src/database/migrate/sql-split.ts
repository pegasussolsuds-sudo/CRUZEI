/**
 * Divide um arquivo .sql em comandos. O Prisma manda cada chamada como prepared statement, que aceita UM comando só,
 * então o executor de migrations precisa separar o arquivo antes.
 *
 * Respeita o que o psql respeita: '...' (com ''), E'...' (com \), "..." (com ""), $tag$...$tag$ (`$1` não abre bloco),
 * comentário -- e /* *\/ aninhado. Um `;` fora disso fecha o comando; comando vazio ou só de comentário some.
 * `code` é o comando com strings, identificadores entre aspas, corpos $$ e comentários trocados por um marcador:
 * serve pra procurar palavra-chave (BEGIN, CONCURRENTLY…) sem cair em texto.
 */

export interface SqlStatement {
  /** texto enviado ao Postgres (sem o `;` final e sem os comentários antes do comando) */
  sql: string;
  /** linha (1-based) onde o comando começa no arquivo */
  line: number;
  /** o comando sem strings/comentários, espaços colapsados — só pra análise */
  code: string;
}

export class SqlSplitError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (linha ${line})`);
    this.name = 'SqlSplitError';
  }
}

/** caractere que pode continuar um identificador no Postgres (inclui $ e não-ASCII) */
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/;
/** abertura de dollar-quote: $$ ou $tag$ (tag não começa com dígito: `$1` é parâmetro) */
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/y;
const BEGIN_ATOMIC = /\bBEGIN\s+ATOMIC\b/i;

export function splitSql(text: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let start = -1; // índice do 1º caractere significativo do comando atual
  let startLine = 0;
  let code = '';

  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (text.charCodeAt(k) === 10) line++;
  };
  const push = (end: number) => {
    if (start < 0) return;
    const compact = code.replace(/\s+/g, ' ').trim();
    if (BEGIN_ATOMIC.test(compact)) {
      throw new SqlSplitError(
        'BEGIN ATOMIC não é suportado pelo executor (use corpo entre $$)',
        startLine,
      );
    }
    out.push({ sql: text.slice(start, end).trim(), line: startLine, code: compact });
    start = -1;
    code = '';
  };

  while (i < n) {
    const ch = text[i];
    const nx = i + 1 < n ? text[i + 1] : '';

    // comentário de linha: pula até o \n (o \n fica pro laço contar a linha)
    if (ch === '-' && nx === '-') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      code += ' ';
      continue;
    }
    // comentário de bloco (aninha, como no Postgres)
    if (ch === '/' && nx === '*') {
      const from = i;
      const l0 = line;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) throw new SqlSplitError('comentário /* sem fechar', l0);
      countLines(from, i);
      code += ' ';
      continue;
    }
    if (ch === ';') {
      push(i);
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      if (ch === '\n') line++;
      code += ch;
      i++;
      continue;
    }

    // daqui pra frente é conteúdo do comando
    if (start < 0) {
      start = i;
      startLine = line;
    }

    if (ch === "'") {
      // E'...' aceita \ como escape; o E tem que estar solto (não ser fim de identificador)
      const prev = i > 0 ? text[i - 1] : '';
      const prev2 = i > 1 ? text[i - 2] : '';
      const escapes = (prev === 'E' || prev === 'e') && !(prev2 && IDENT_CHAR.test(prev2));
      i = skipQuoted(text, i, "'", escapes, line);
      continue;
    }
    if (ch === '"') {
      i = skipQuoted(text, i, '"', false, line);
      continue;
    }
    if (ch === '$') {
      const prev = i > 0 ? text[i - 1] : '';
      if (!(prev && IDENT_CHAR.test(prev))) {
        DOLLAR_TAG.lastIndex = i;
        const m = DOLLAR_TAG.exec(text);
        if (m) {
          const tag = m[0];
          const close = text.indexOf(tag, i + tag.length);
          if (close < 0) throw new SqlSplitError(`bloco ${tag} sem fechar`, line);
          const from = i;
          i = close + tag.length;
          countLines(from, i);
          code += ' $$ ';
          continue;
        }
      }
    }
    if (ch === '\\') {
      throw new SqlSplitError(
        'meta-comando do psql (\\...) não é SQL: o executor não usa psql',
        line,
      );
    }
    code += ch;
    i++;
  }
  push(n);
  return out;

  /** pula uma string/identificador entre aspas; devolve o índice logo depois da aspa de fechamento */
  function skipQuoted(
    src: string,
    from: number,
    quote: string,
    backslash: boolean,
    atLine: number,
  ): number {
    let j = from + 1;
    while (j < n) {
      const c = src[j];
      if (backslash && c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) {
        if (src[j + 1] === quote) {
          j += 2;
          continue;
        }
        countLines(from, j + 1);
        code += quote === "'" ? " '' " : ' "" ';
        return j + 1;
      }
      j++;
    }
    throw new SqlSplitError(
      quote === "'" ? 'aspas simples sem fechar' : 'aspas duplas sem fechar',
      atLine,
    );
  }
}

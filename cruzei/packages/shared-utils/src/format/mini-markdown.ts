// Markdown mínimo dos documentos legais (cruzei/legal/*.md): títulos, parágrafos, listas, **negrito** e [links](url).
// O servidor transforma em HTML (páginas públicas pras lojas) e o app em componentes nativos — mesmo parser nos dois.

export interface MdInline {
  text: string;
  bold?: boolean;
  href?: string;
}

export type MdBlock =
  | { type: 'h1' | 'h2' | 'h3'; inlines: MdInline[] }
  | { type: 'p'; inlines: MdInline[] }
  | { type: 'ul' | 'ol'; items: MdInline[][] };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], href: m[3] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseMiniMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inlines: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: list.type, items: list.items.map(parseInline) });
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: `h${h[1].length}` as 'h1' | 'h2' | 'h3', inlines: parseInline(h[2]) });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    // linha recuada logo após um item = continuação do item
    if (list && /^\s{2,}/.test(line)) {
      list.items[list.items.length - 1] += ' ' + t;
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return blocks;
}

/** troca {{CHAVE}} pelos valores; chave sem valor vira "[preencher: CHAVE]" (nunca some calada) */
export function fillTemplate(md: string, vars: Record<string, string | undefined>): string {
  return md.replace(/\{\{([A-Z_]+)\}\}/g, (_all, k: string) => {
    const v = vars[k];
    return v && v.trim() ? v.trim() : `[preencher: ${k}]`;
  });
}

/** chaves {{...}} usadas no texto (o servidor recusa subir em produção com alguma sem valor) */
export function templateKeys(md: string): string[] {
  return [...new Set([...md.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];
}

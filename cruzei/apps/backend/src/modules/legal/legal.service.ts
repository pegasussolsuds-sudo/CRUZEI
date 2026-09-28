import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION, type LegalDoc, type LegalDocMeta, type LegalSlug } from '@cruzei/shared-types';
import { fillTemplate, parseMiniMarkdown, templateKeys, type MdInline } from '@cruzei/shared-utils';

const FILES: Record<LegalSlug, string> = {
  termos: 'termos-de-uso.md',
  privacidade: 'politica-de-privacidade.md',
  'seguranca-infantil': 'padroes-seguranca-infantil.md',
};

/** {{CHAVE}} dos textos ← variável de ambiente (dados da empresa só existem na configuração, nunca no repositório) */
export const LEGAL_ENV: Record<string, string> = {
  EMPRESA: 'LEGAL_COMPANY_NAME',
  CNPJ: 'LEGAL_CNPJ',
  ENDERECO: 'LEGAL_ADDRESS',
  FORO: 'LEGAL_FORUM',
  EMAIL_SUPORTE: 'SUPPORT_EMAIL',
  EMAIL_PRIVACIDADE: 'PRIVACY_EMAIL',
  ENCARREGADO: 'DPO_NAME',
  EMAIL_SEGURANCA_INFANTIL: 'CHILD_SAFETY_EMAIL',
};

/** onde ficam os .md: LEGAL_DIR, ou cruzei/legal subindo a partir do processo/compilado */
export function resolveLegalDir(): string | null {
  const candidates = [
    process.env.LEGAL_DIR,
    path.resolve(process.cwd(), 'legal'),
    path.resolve(process.cwd(), '../../legal'),
    path.resolve(__dirname, '../../../../../../legal'),
    path.resolve(__dirname, '../../../../../legal'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(path.join(p, FILES.termos))) ?? null;
}

/** variáveis de ambiente que faltam pros textos legais (produção não sobe sem elas) */
export function missingLegalEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = resolveLegalDir();
  if (!dir) return ['LEGAL_DIR (pasta cruzei/legal não encontrada)'];
  const keys = new Set<string>();
  for (const f of Object.values(FILES)) for (const k of templateKeys(fs.readFileSync(path.join(dir, f), 'utf8'))) keys.add(k);
  return [...keys]
    .map((k) => LEGAL_ENV[k])
    .filter((v): v is string => Boolean(v))
    .filter((v) => !env[v]?.trim());
}

@Injectable()
export class LegalService {
  private readonly cache = new Map<LegalSlug, LegalDoc>();

  list(): LegalDocMeta[] {
    return (Object.keys(FILES) as LegalSlug[]).map((slug) => ({ slug, title: this.get(slug).title }));
  }

  get(slug: string): LegalDoc {
    if (!(slug in FILES)) throw new NotFoundException('Documento não encontrado');
    const s = slug as LegalSlug;
    const hit = this.cache.get(s);
    if (hit) return hit;
    const dir = resolveLegalDir();
    if (!dir) throw new NotFoundException('Documentos legais indisponíveis');
    const raw = fs.readFileSync(path.join(dir, FILES[s]), 'utf8');
    const vars: Record<string, string | undefined> = { VERSAO: LEGAL_VERSION, DATA_VIGENCIA: formatDate(LEGAL_EFFECTIVE_DATE) };
    for (const [k, envName] of Object.entries(LEGAL_ENV)) vars[k] = process.env[envName];
    const markdown = fillTemplate(raw, vars);
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? s;
    const doc: LegalDoc = { slug: s, title, version: LEGAL_VERSION, effectiveDate: LEGAL_EFFECTIVE_DATE, markdown };
    this.cache.set(s, doc);
    return doc;
  }

  /** página pública (URL da política na ficha das lojas; link "Termos" fora do app) */
  html(slug: string): string {
    const doc = this.get(slug);
    const body = parseMiniMarkdown(doc.markdown)
      .map((b) => {
        if ('items' in b) return `<${b.type}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.type}>`;
        return `<${b.type}>${inline(b.inlines)}</${b.type}>`;
      })
      .join('\n');
    const nav = this.list()
      .map((d) => (d.slug === doc.slug ? `<strong>${esc(d.title)}</strong>` : `<a href="/legal/${d.slug}">${esc(d.title)}</a>`))
      .join(' · ');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} · Metch</title>
<style>body{margin:0;background:#FAFAFA;color:#0A0A1A;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}nav{font-size:14px;color:#525252;margin-bottom:28px}
h1{font-size:30px;line-height:1.2;margin:0 0 8px}h2{font-size:21px;margin:36px 0 8px}h3{font-size:17px;margin:24px 0 6px}
a{color:#B3006A}li{margin:4px 0}.brand{font-weight:700;letter-spacing:-.01em;font-size:18px}
@media (prefers-color-scheme:dark){body{background:#0A0A1A;color:#F2F2F8}nav{color:#A3A3A3}a{color:#FF5CB8}}</style></head>
<body><main><p class="brand">metch</p><nav>${nav}</nav>
${body}
</main></body></html>`;
  }
}

function inline(parts: MdInline[]): string {
  return parts
    .map((p) => {
      const t = esc(p.text);
      if (p.href && /^(https?:|mailto:|\/)/i.test(p.href)) return `<a href="${esc(p.href)}">${t}</a>`;
      return p.bold ? `<strong>${t}</strong>` : t;
    })
    .join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

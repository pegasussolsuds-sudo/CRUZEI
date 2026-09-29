import { BadRequestException } from '@nestjs/common';

// Cursor opaco das listas do painel: base64url de um array JSON (ex.: [data ISO, id]). O painel só devolve o que recebeu.

export function encodeCursor(parts: (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/** cursor ausente → null; quebrado → 400 (nunca vira SQL estranho) */
export function decodeCursor(raw: string | undefined | null, size: number): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(v) &&
      v.length === size &&
      v.every((x) => typeof x === 'string' || typeof x === 'number')
    ) {
      return v.map(String);
    }
  } catch {
    /* cai no 400 */
  }
  throw new BadRequestException({ error: 'invalid_cursor', message: 'Cursor inválido' });
}

/** limite da página: padrão e teto */
export function pageSize(raw: unknown, def = 30, max = 100): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.floor(n)) : def;
}

/** data do cursor tem que ser uma data de verdade */
export function cursorDate(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestException({ error: 'invalid_cursor', message: 'Cursor inválido' });
  return d;
}

/** id numérico (bigint) do cursor */
export function cursorBigInt(s: string): bigint {
  if (!/^\d{1,18}$/.test(s))
    throw new BadRequestException({ error: 'invalid_cursor', message: 'Cursor inválido' });
  return BigInt(s);
}

/**
 * Horário do banco com os MICROSSEGUNDOS, em UTC, pro cursor (o Date do JS corta em ms: dois registros no mesmo ms
 * pulariam ou repetiriam na página seguinte). No SELECT: `${CURSOR_TS('coluna')} AS cursor_at`.
 */
const TS_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

export function cursorTs(s: string): string {
  if (!TS_TEXT.test(s))
    throw new BadRequestException({ error: 'invalid_cursor', message: 'Cursor inválido' });
  return s;
}

// Erro do servidor que aponta um campo do perfil (nome, bio ou @ do Instagram): o cadastro volta pra etapa do campo e
// o Editar perfil mostra embaixo dele, com o `message` do jeito que veio (já é amigável e diz o que ajustar).
import { TEXT_FIELDS, type TextBlockedError, type TextField } from '@cruzei/shared-types';

/** campos do perfil que o servidor pode recusar (mensagem de chat tem tratamento próprio) */
export type ProfileTextField = Exclude<TextField, 'message'>;

export interface FieldError {
  field: ProfileTextField;
  message: string;
  /** 'text_blocked' (filtro de abuso), 'instagram_invalid' ou 'name_invalid' */
  code: string;
}

function bodyOf(err: unknown): Record<string, unknown> | null {
  const res = (err as { response?: { status?: number; data?: unknown } } | null)?.response;
  if (!res || res.status !== 400) return null;
  const data = res.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** 400 text_blocked do filtro de abuso (TextBlockedError) ou null */
export function textBlockedOf(err: unknown): TextBlockedError | null {
  const b = bodyOf(err);
  if (!b || b.error !== 'text_blocked') return null;
  const field = b.field as TextField;
  if (!(TEXT_FIELDS as readonly string[]).includes(field)) return null;
  return {
    error: 'text_blocked',
    field,
    reason: b.reason as TextBlockedError['reason'],
    message: typeof b.message === 'string' && b.message ? b.message : 'Esse texto fere as regras do Metch. Ajusta e tenta de novo?',
  };
}

const FALLBACK: Record<string, string> = {
  instagram_invalid: 'Esse @ não rola no Instagram: só letras, números, ponto e _ (até 30), sem ponto no começo ou no fim.',
  name_invalid: 'Seu nome precisa ter pelo menos 2 letras.',
};

/** erro do servidor que aponta nome, bio ou @ (filtro de abuso, @ fora da regra, nome curto); o resto → null */
export function profileFieldErrorOf(err: unknown): FieldError | null {
  const blocked = textBlockedOf(err);
  if (blocked) return blocked.field === 'message' ? null : { field: blocked.field, message: blocked.message, code: 'text_blocked' };
  const b = bodyOf(err);
  const code = typeof b?.error === 'string' ? b.error : '';
  const field: ProfileTextField | null = code === 'instagram_invalid' ? 'instagram' : code === 'name_invalid' ? 'name' : null;
  if (!field) return null;
  const msg = typeof b?.message === 'string' && b.message ? b.message : FALLBACK[code];
  return { field, message: msg, code };
}

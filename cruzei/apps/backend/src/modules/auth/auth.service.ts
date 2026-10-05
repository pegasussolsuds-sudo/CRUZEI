import type {
  AccountClaim,
  AccountDeletionRestored,
  Gender,
  PhoneReleaseReason,
} from '@cruzei/shared-types';
import {
  checkProfileText,
  isAtLeast18,
  normalizePhoneBR,
  randomAvatarConfig,
} from '@cruzei/shared-utils';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuid } from 'uuid';

import { maskName } from '../../common/name-mask';
import { decideAnonymous } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';
import { DeletionStateService } from '../account/deletion-state.service';
import {
  cleanBio,
  cleanInterestNames,
  cleanName,
  INSTAGRAM_INVALID,
  NAME_INVALID,
  parseInstagramInput,
  profileCompleteness,
} from '../users/profile-prefs';

import { claimFailsKey, PhoneReleaseService, type RequestMeta } from './phone-release.service';
import { codeExpired, phoneInvalid } from './sms/sms-errors';
import { SmsService } from './sms.service';

/** tipo do token: o refresh (30 dias) nunca vale como Bearer; o access (15 min) nunca renova sessão */
export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string; // userId
  phone?: string;
  /** ausente = token emitido antes do tipo existir (aceito no /auth/refresh até vencer, pra ninguém cair) */
  typ?: TokenType;
  /** emitido em (segundos; o jsonwebtoken põe sozinho): antes de users.sessions_valid_after = sessão revogada */
  iat?: number;
}

/** o refresh não autentica pedido nem socket (o segredo é o mesmo: sem isso o de 30 dias serviria de Bearer) */
export function isRefreshPayload(p: Pick<JwtPayload, 'typ'> | null | undefined): boolean {
  return p?.typ === 'refresh';
}

/** /auth/refresh só aceita refresh (ou token antigo, sem tipo); access mandado ali é recusado */
export function canRenewWith(p: Pick<JwtPayload, 'typ'> | null | undefined): boolean {
  return !!p && (p.typ === 'refresh' || p.typ === undefined);
}

/**
 * resposta do /auth/login e do /auth/claim/* (LoginResponse do shared-types, com user.id null quando não há sessão):
 * conta ativa → tokens; número livre → isNew; conta parada → claim ("Essa conta é sua?")
 */
export interface LoginResult {
  user: { id: string | null; name: string; phone: string | null; isNew: boolean };
  token: string | null;
  refreshToken: string | null;
  claim?: AccountClaim;
  released?: PhoneReleaseReason;
  /** exclusão da conta cancelada agora (POST /auth/deletion/cancel) */
  restored?: AccountDeletionRestored;
}

export interface SessionResult extends LoginResult {
  user: { id: string; name: string; phone: string | null; isNew: false };
  token: string;
  refreshToken: string;
}

// ---- número reciclado: desafio "Essa conta é sua?" no Redis ----
/** o desafio vale 10 min (o mesmo prazo da prova de SMS do cadastro) */
export const CLAIM_TTL_S = 600;
/** trava curta (por desafio e por conta) enquanto uma tentativa é conferida: rajada leva 429 */
export const CLAIM_LOCK_TTL_S = 5;
/** limite das rotas /auth/claim/* além do por IP do throttler: por desafio e por conta */
export const CLAIM_RATE = {
  challenge: { limit: 5, ttlS: 60 },
  user: { limit: 10, ttlS: 3_600 },
} as const;
const claimKey = (id: string) => `auth:claim:${id}`;
const lockKey = (scope: 'c' | 'u', id: string) => `auth:claim:lock:${scope}:${id}`;
const rateKey = (scope: 'c' | 'u', id: string) => `auth:claim:rl:${scope}:${id}`;
interface ClaimData {
  /** conta antiga */
  u: string;
  /** número que confirmou o SMS */
  p: string;
}

const CLAIM_EXPIRED = {
  error: 'claim_expired',
  message: 'Essa confirmação venceu. Pede outro código pra entrar.',
} as const;

/** mesmo formato do 429 do throttler */
const CLAIM_TOO_MANY = {
  error: 'too_many_requests',
  message: 'Muitas tentativas. Espera um minuto e tenta de novo.',
} as const;

const CLAIM_BUSY = {
  error: 'too_many_requests',
  message: 'Calma, ainda tô conferindo a tentativa anterior. Tenta de novo em instantes.',
} as const;

const DAY_MS = 86_400_000;

/** mesma data de nascimento? A coluna é @db.Date (meia-noite UTC); o app manda 'AAAA-MM-DD' */
export function sameBirthDate(stored: Date, typed: string): boolean {
  return !Number.isNaN(stored.getTime()) && stored.toISOString().slice(0, 10) === typed;
}

/** cadastro nasce invisível? Só 'visible' nasce visível; ausente (app antigo) ou 'anonymous' → invisível */
export function isAnonymousSignup(mode: string | null | undefined): boolean {
  return mode !== 'visible';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly sms: SmsService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
    private readonly phones: PhoneReleaseService,
    /** exclusão com prazo de arrependimento (AccountModule global); ausente nos testes antigos = caminho legado */
    @Optional() private readonly deletions?: DeletionStateService,
  ) {}

  /** `ip` (req.ip) entra no teto de envios por conexão */
  async requestCode(phone: string, ip?: string | null) {
    return this.sms.sendCode(phone, ip);
  }

  /** número de revisão das lojas? (os testes antigos falsificam o SmsService sem esse método) */
  private isReviewPhone(phone: string): boolean {
    return typeof this.sms.isReviewPhone === 'function' && this.sms.isReviewPhone(phone);
  }

  /** dias sem uso pra conta contar como parada (AUTH_DORMANT_DAYS, padrão 90; 0 desliga a confirmação) */
  private dormantDays(): number {
    const v = Number(this.cfg.get('auth.dormantDays'));
    return Number.isFinite(v) && v >= 0 ? v : 90;
  }

  /** erros de data que liberam o número (AUTH_CLAIM_MAX_ATTEMPTS, padrão 3) */
  private maxAttempts(): number {
    const v = Number(this.cfg.get('auth.claimMaxAttempts'));
    return Number.isInteger(v) && v >= 1 ? v : 3;
  }

  /** conta parada: último uso (posição, login/refresh, push, criação) há >= dormantDays */
  private async isDormant(u: {
    id: string;
    lastActiveAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    const days = this.dormantDays();
    if (days <= 0) return false;
    const cutoff = Date.now() - days * DAY_MS;
    // atalho sem consulta: posição recente ou conta nova já provam uso
    if (u.lastActiveAt.getTime() > cutoff || u.createdAt.getTime() > cutoff) return false;
    const at = await this.phones.lastUsedAt(u.id);
    return !at || at.getTime() <= cutoff;
  }

  async login(phoneRaw: string, code: string, meta?: RequestMeta): Promise<LoginResult> {
    const phone = normalizePhoneBR(phoneRaw);
    if (!phone) throw phoneInvalid();
    // true ou lança o erro do SMS (401 code_invalid/code_expired, 429 sms_locked); o `if` é só segurança
    const ok = await this.sms.verifyCode(phone, code);
    if (!ok) throw codeExpired();

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, name: true, createdAt: true, lastActiveAt: true, deletedAt: true },
    });
    // usuário será criado no /auth/register com dados completos
    if (!user) return this.startSignup(phone);
    if (user.deletedAt) {
      // exclusão pedida no prazo: nada de sessão nem de liberar o número; 409 com desafio pra cancelar a exclusão
      const pending = await this.deletions?.loginChallenge(user.id, phone);
      if (pending) throw new ConflictException(pending);
      // exclusão antiga sem pedido: o número fica livre na hora (conta nova nasce em revisão se a antiga estava banida)
      return this.releaseAndStartSignup(user.id, phone, 'account_deleted', meta);
    }
    // conta parada: NADA de token nem de access_log (senão ela "acorda" e a próxima tentativa entra direto)
    // número de revisão das lojas nunca cai no "Essa conta é sua?" (revisor não sabe a data); ban/suspensão valem
    if (!this.isReviewPhone(phone) && (await this.isDormant(user)))
      return this.claimFor(user, phone, meta);
    return this.issueTokens(user.id);
  }

  /**
   * "Sim, é minha": confere a data de nascimento. Acertou → sessão normal. Errou → 401 claim_mismatch com as
   * tentativas que restam; no último erro (somando TODOS os desafios da conta, sem prazo) o número sai da conta antiga
   * e a pessoa segue pro cadastro (released).
   */
  async confirmClaim(
    challengeId: string,
    birthDate: string,
    meta?: RequestMeta,
  ): Promise<LoginResult> {
    const c = await this.readClaim(challengeId);
    await this.limitClaim(challengeId, c.u);
    const user = await this.prisma.user.findUnique({
      where: { id: c.u },
      select: { id: true, phone: true, birthDate: true },
    });
    if (!user || user.phone !== c.p) {
      await this.redis.client.del(claimKey(challengeId));
      throw new UnauthorizedException({ ...CLAIM_EXPIRED });
    }
    const unlock = await this.lockClaim(challengeId, user.id);
    try {
      // entre a leitura e a trava, o pedido anterior pode ter usado o desafio (acertou ou liberou)
      if (!(await this.redis.client.get(claimKey(challengeId)))) {
        throw new UnauthorizedException({ ...CLAIM_EXPIRED });
      }
      return await this.checkBirthDate(challengeId, c, user.birthDate, birthDate, meta);
    } finally {
      await unlock();
    }
  }

  /** "Não é minha": o número sai da conta antiga e a pessoa segue pro cadastro (released 'not_mine') */
  async releaseClaim(challengeId: string, meta?: RequestMeta): Promise<LoginResult> {
    const peek = await this.readClaim(challengeId);
    await this.limitClaim(challengeId, peek.u);
    // não corre junto com uma conferência de data do mesmo desafio/conta
    const unlock = await this.lockClaim(challengeId, peek.u);
    try {
      const c = parseClaim(await this.redis.client.getdel(claimKey(challengeId)));
      if (!c) throw new UnauthorizedException({ ...CLAIM_EXPIRED });
      return await this.releaseAndStartSignup(c.u, c.p, 'not_mine', meta);
    } finally {
      await unlock();
    }
  }

  async register(payload: {
    phone: string;
    name: string;
    birthDate: Date;
    gender: string;
    orientation?: string | null;
    lookingFor?: string;
    /** versão dos Termos/Política que o app mostrou e a pessoa aceitou */
    termsVersion: string;
    showOrientation?: boolean;
    sameOrientationFirst?: boolean;
    showMe?: string;
    /** ausente = app antigo: nasce invisível com a janela grátis de 24 h (como antes) */
    visibilityMode?: 'visible' | 'anonymous' | null;
    /** etapas opcionais: bio (vazia = sem), @ do Instagram (aceita @/link; fora da regra = 400) e NOMES do catálogo */
    bio?: string | null;
    instagram?: string | null;
    interests?: string[] | null;
  }): Promise<SessionResult> {
    const phone = normalizePhoneBR(payload.phone);
    if (!phone) throw new UnauthorizedException('Telefone inválido');
    // "Não-binário" saiu (só Mulher/Homem/Outro): app antigo que ainda manda non_binary grava other
    const gender: Gender = payload.gender === 'non_binary' ? 'other' : (payload.gender as Gender);
    // campos de texto validados ANTES de gastar a prova do SMS: um 400 aqui não obriga a pedir código de novo
    const name = cleanName(payload.name);
    if (!name) throw new BadRequestException(NAME_INVALID);
    const bio = cleanBio(payload.bio) ?? null;
    const insta = parseInstagramInput(payload.instagram);
    if (insta && !insta.ok) throw new BadRequestException(INSTAGRAM_INVALID);
    const instagramHandle = insta?.ok ? insta.handle : null;
    // filtro de abuso (nome, bio, @): 400 text_blocked com o campo e o que ajustar (o app volta pra etapa dele)
    const blocked = checkProfileText({ name, bio, instagram: instagramHandle });
    if (blocked) throw new BadRequestException(blocked);
    const interestNames = cleanInterestNames(payload.interests);

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new UnauthorizedException('Telefone já cadastrado');
    if (Number.isNaN(payload.birthDate.getTime()) || !isAtLeast18(payload.birthDate)) {
      throw new BadRequestException({
        error: 'underage',
        message: 'Precisa ter 18 anos ou mais pra usar o Metch',
      });
    }
    // exibir / ordenar pela orientação exige ter orientação (CHECK users_orientation_flags_chk)
    const orientation = payload.orientation || null;
    if (!orientation && (payload.showOrientation || payload.sameOrientationFirst)) {
      throw new BadRequestException({
        error: 'orientation_required',
        message: 'Escolhe tua orientação antes de exibir ou ordenar por ela',
      });
    }
    // sem código de SMS confirmado não existe conta: nada de cadastrar o número dos outros
    const proof = await this.redis.consumeSignupProof(phone);
    if (!proof) throw new UnauthorizedException('Confirma o código do SMS antes de criar a conta');

    const id = uuid();
    const now = new Date();
    // só nasce visível quem mandou 'visible' (o app novo sempre manda). O app antigo não manda o campo nem quando a
    // pessoa escolhe "Anônimo": sem o campo nasce invisível, com a janela grátis de 24 h, como era antes
    const anonymous = isAnonymousSignup(payload.visibilityMode);
    const anonymousUntil = anonymous
      ? decideAnonymous({ premium: false, visibilityMode: 'visible', anonymousUntil: null }, now)
          .until
      : null;
    const user = await this.prisma.$transaction(async (tx) => {
      // número liberado de outra conta: liga o histórico; se ela estava banida/suspensa, esta nasce em revisão
      const releases = await this.phones.pendingReleases(tx, phone);
      const from = releases.find((r) => PhoneReleaseService.needsHold([r])) ?? null;
      // interesses do cadastro: só os que existem no catálogo (nome desconhecido é ignorado, como no PATCH /me)
      const interestRows = interestNames.length
        ? await tx.interest.findMany({
            where: { name: { in: interestNames } },
            select: { id: true },
          })
        : [];
      const created = await tx.user.create({
        data: {
          id,
          phone,
          name,
          bio,
          instagramHandle,
          birthDate: payload.birthDate,
          gender,
          orientation: (orientation ?? undefined) as never,
          orientationConsentedAt: orientation ? now : null,
          showOrientation: !!orientation && !!payload.showOrientation,
          sameOrientationFirst: !!orientation && !!payload.sameOrientationFirst,
          showMe: (payload.showMe ?? 'everyone') as never,
          visibilityMode: anonymous ? 'anonymous' : 'visible',
          anonymousUntil,
          lookingFor: (payload.lookingFor ?? 'unspecified') as never,
          // avatar inicial determinístico (seed = id → mesmo visual em qualquer cliente)
          avatarConfig: randomAvatarConfig(id, { gender }) as never,
          // completude inicial (mesma conta do PATCH /me): nome, intenção, bio e interesses — as fotos vêm depois
          profileCompleteness: profileCompleteness({
            name,
            bio,
            photos: 0,
            interests: interestRows.length,
            lookingFor: payload.lookingFor,
          }),
          termsVersion: payload.termsVersion,
          termsAcceptedAt: now,
          reviewHoldAt: from ? now : null,
        },
      });
      if (interestRows.length) {
        await tx.userInterest.createMany({
          data: interestRows.map((i) => ({ userId: id, interestId: i.id })),
          skipDuplicates: true,
        });
      }
      await this.phones.linkNewAccount(
        tx,
        releases.map((r) => r.id),
        id,
      );
      if (from) {
        const was = from.accountStatus === 'banned' ? 'banida' : 'suspensa';
        const when = from.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        // fora da descoberta até a revisão (mesmo registro do holdForReview) + item na fila da moderação
        await tx.moderationAction.create({
          data: {
            moderatorId: null,
            targetUserId: id,
            action: 'auto_hold',
            note: `Número veio de uma conta ${was} (${from.userId}), liberado em ${when}`,
          },
        });
        await tx.report.create({
          data: {
            reporterId: null,
            reportedId: id,
            reason: 'other',
            priority: 1,
            description: `Conta nova com o número de uma conta ${was} (${from.userId}). Confere se é a mesma pessoa voltando.`,
          },
        });
      }
      return created;
    });
    return this.issueTokens(user.id);
  }

  async refresh(refreshToken: string): Promise<SessionResult> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify(refreshToken, { secret: this.cfg.get('jwt.secret') }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
    if (!canRenewWith(payload)) throw new UnauthorizedException('Refresh token inválido');
    // fora do try: conta banida/suspensa responde 403 com o motivo (não "token inválido"); sessão revogada 401
    return this.issueTokens(payload.sub, payload.iat);
  }

  /** sessão nova de uma conta já conferida por outro fluxo (ex.: exclusão cancelada): mesmas regras do login */
  async openSession(userId: string): Promise<SessionResult> {
    return this.issueTokens(userId);
  }

  async logout(userId: string): Promise<void> {
    await this.redis.client.del(`profile:${userId}`);
  }

  // ---------------------------------------------------------------------------------------------

  /** número livre: prova de posse (consumida uma única vez pelo /auth/register em até 10 min) */
  private async startSignup(phone: string, released?: PhoneReleaseReason): Promise<LoginResult> {
    await this.redis.setSignupProof(phone);
    return {
      user: { id: null, name: '', phone, isNew: true },
      token: null,
      refreshToken: null,
      ...(released ? { released } : {}),
    };
  }

  private async releaseAndStartSignup(
    userId: string,
    phone: string,
    reason: PhoneReleaseReason,
    meta?: RequestMeta,
  ): Promise<LoginResult> {
    const ok = await this.phones.release({ userId, phone, reason, meta });
    if (!ok) {
      // outro pedido chegou antes: segue só se o número ficou livre mesmo
      const holder = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (holder) throw new UnauthorizedException({ ...CLAIM_EXPIRED });
    }
    // o contador de erros da conta antiga zera dentro do phones.release (vale pra liberação do painel também)
    return this.startSignup(phone, reason);
  }

  private async claimFor(
    u: { id: string; name: string },
    phone: string,
    meta?: RequestMeta,
  ): Promise<LoginResult> {
    const max = this.maxAttempts();
    const fails = Number(await this.redis.client.get(claimFailsKey(u.id))) || 0;
    // já errou `max` vezes somando tudo e o número não saiu (queda no meio da liberação): libera agora
    if (fails >= max) return this.releaseAndStartSignup(u.id, phone, 'birthdate_mismatch', meta);
    const challengeId = uuid();
    const data: ClaimData = { u: u.id, p: phone };
    await this.redis.client.set(claimKey(challengeId), JSON.stringify(data), 'EX', CLAIM_TTL_S);
    return {
      user: { id: null, name: '', phone, isNew: false },
      token: null,
      refreshToken: null,
      claim: {
        challengeId,
        maskedName: maskName(u.name),
        // não manda mais o mês de criação (ajudava a adivinhar de quem é a conta); campo fica pro app antigo
        createdMonth: null,
        attemptsLeft: max - fails,
        expiresIn: CLAIM_TTL_S,
      },
    };
  }

  private async readClaim(challengeId: string): Promise<ClaimData> {
    const c = parseClaim(await this.redis.client.get(claimKey(challengeId)));
    if (!c) throw new UnauthorizedException({ ...CLAIM_EXPIRED });
    return c;
  }

  /**
   * Confere a data com a tentativa JÁ reservada: o INCR vem antes da comparação, então numa rajada cada pedido pega um
   * número e só `max` chegam a comparar. n > max → libera sem comparar; acertou → zera; `max`-ésimo erro → libera.
   */
  private async checkBirthDate(
    challengeId: string,
    c: ClaimData,
    stored: Date,
    typed: string,
    meta?: RequestMeta,
  ): Promise<LoginResult> {
    const max = this.maxAttempts();
    const n = await this.reserveAttempt(c.u);
    if (n > max) return this.releaseExhausted(challengeId, c, meta);
    if (sameBirthDate(stored, typed)) {
      await this.redis.client.del(claimKey(challengeId));
      await this.redis.client.del(claimFailsKey(c.u));
      // banida/suspensa: o issueTokens responde 403 com o motivo, como no login de sempre
      return this.issueTokens(c.u);
    }
    if (n < max) {
      const left = max - n;
      throw new UnauthorizedException({
        error: 'claim_mismatch',
        message:
          left === 1 ? 'Não bateu. Última tentativa.' : `Não bateu. Restam ${left} tentativas.`,
        attemptsLeft: left,
      });
    }
    return this.releaseExhausted(challengeId, c, meta);
  }

  /** esgotou: um pedido só libera (GETDEL); o outro que chegar junto vê o desafio vencido */
  private async releaseExhausted(
    challengeId: string,
    c: ClaimData,
    meta?: RequestMeta,
  ): Promise<LoginResult> {
    if (!(await this.redis.client.getdel(claimKey(challengeId)))) {
      throw new UnauthorizedException({ ...CLAIM_EXPIRED });
    }
    return this.releaseAndStartSignup(c.u, c.p, 'birthdate_mismatch', meta);
  }

  /** reserva a tentativa (INCR atômico) SEM prazo: só zera no acerto ou na liberação do número */
  private async reserveAttempt(userId: string): Promise<number> {
    const k = claimFailsKey(userId);
    const n = await this.redis.client.incr(k);
    // contador gravado com prazo pela versão anterior (24 h): tira o prazo
    await this.redis.client.persist(k);
    return n;
  }

  /** limite por desafio e por conta (o throttler só conta por IP): passou → 429 */
  private async limitClaim(challengeId: string, userId: string): Promise<void> {
    const rules = [
      [rateKey('c', challengeId), CLAIM_RATE.challenge],
      [rateKey('u', userId), CLAIM_RATE.user],
    ] as const;
    for (const [k, { limit, ttlS }] of rules) {
      const n = await this.redis.client.incr(k);
      // EXPIRE NX em toda tentativa: se uma queda entre o INCR e o EXPIRE deixou a chave sem prazo, a próxima conserta
      // (sem isso a conta ficaria com 429 pra sempre, nem o "Não é minha" liberaria)
      await this.redis.client.expire(k, ttlS, 'NX');
      if (n > limit) throw new HttpException({ ...CLAIM_TOO_MANY }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Trava (SET NX curto) do desafio E da conta durante a checagem: pedido junto no mesmo desafio, ou em outro desafio
   * da mesma conta, leva 429 em vez de comparar em paralelo. Devolve quem solta.
   */
  private async lockClaim(challengeId: string, userId: string): Promise<() => Promise<void>> {
    const token = uuid();
    const held: string[] = [];
    const unlock = async () => {
      for (const k of held) {
        try {
          // só apaga se ainda é nossa (se venceu, outro pedido pode ter pegado)
          if ((await this.redis.client.get(k)) === token) await this.redis.client.del(k);
        } catch {
          /* vence sozinha em segundos */
        }
      }
    };
    for (const k of [lockKey('c', challengeId), lockKey('u', userId)]) {
      if ((await this.redis.client.set(k, token, 'EX', CLAIM_LOCK_TTL_S, 'NX')) !== 'OK') {
        await unlock();
        throw new HttpException({ ...CLAIM_BUSY }, HttpStatus.TOO_MANY_REQUESTS);
      }
      held.push(k);
    }
    return unlock;
  }

  private async issueTokens(userId: string, tokenIat?: number): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Usuário não encontrado');
    // banida/suspensa não ganha token novo (login e refresh): 403 com o motivo, que o app mostra.
    // Refresh emitido antes de sessions_valid_after (número liberado): 401 session_revoked
    await this.accounts.assertActive(userId, tokenIat);

    // telefone do BANCO (o do token antigo pode ter saído da conta)
    const base = { sub: userId, phone: user.phone ?? undefined };
    const accessTtl = this.cfg.get<number>('jwt.accessTtl') ?? 900;
    const refreshTtl = this.cfg.get<number>('jwt.refreshTtl') ?? 2_592_000;

    const access: JwtPayload = { ...base, typ: 'access' };
    const refresh: JwtPayload = { ...base, typ: 'refresh' };
    const token = this.jwt.sign(access, { expiresIn: accessTtl });
    const refreshToken = this.jwt.sign(refresh, { expiresIn: refreshTtl });

    return {
      user: { id: user.id, name: user.name, phone: user.phone, isNew: false },
      token,
      refreshToken,
    };
  }
}

function parseClaim(raw: string | null): ClaimData | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<ClaimData>;
    return typeof c.u === 'string' && typeof c.p === 'string' ? { u: c.u, p: c.p } : null;
  } catch {
    return null;
  }
}

import { isAtLeast18, normalizePhoneBR, randomAvatarConfig } from '@cruzei/shared-utils';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuid } from 'uuid';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';

import { SmsService } from './sms.service';

/** tipo do token: o refresh (30 dias) nunca vale como Bearer; o access (15 min) nunca renova sessão */
export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string; // userId
  phone?: string;
  /** ausente = token emitido antes do tipo existir (aceito no /auth/refresh até vencer, pra ninguém cair) */
  typ?: TokenType;
}

/** o refresh não autentica pedido nem socket (o segredo é o mesmo: sem isso o de 30 dias serviria de Bearer) */
export function isRefreshPayload(p: Pick<JwtPayload, 'typ'> | null | undefined): boolean {
  return p?.typ === 'refresh';
}

/** /auth/refresh só aceita refresh (ou token antigo, sem tipo); access mandado ali é recusado */
export function canRenewWith(p: Pick<JwtPayload, 'typ'> | null | undefined): boolean {
  return !!p && (p.typ === 'refresh' || p.typ === undefined);
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
  ) {}

  async requestCode(phone: string) {
    return this.sms.sendCode(phone);
  }

  async login(phoneRaw: string, code: string) {
    const phone = normalizePhoneBR(phoneRaw);
    if (!phone) throw new UnauthorizedException('Telefone inválido');
    const ok = await this.sms.verifyCode(phone, code);
    if (!ok) throw new UnauthorizedException('Código inválido ou expirado');

    const user = await this.prisma.user.findUnique({ where: { phone } });
    const isNew = !user;
    if (isNew) {
      // prova de posse do número (consumida uma única vez pelo /auth/register em até 10 min)
      await this.redis.setSignupProof(phone);
      // usuário será criado no /auth/register com dados completos
      return {
        user: { id: null, name: '', phone, isNew: true },
        token: null,
        refreshToken: null,
      };
    }
    return this.issueTokens(user.id, phone);
  }

  async register(payload: {
    phone: string;
    name: string;
    birthDate: Date;
    gender: string;
    orientation?: string;
    lookingFor?: string;
    /** versão dos Termos/Política que o app mostrou e a pessoa aceitou */
    termsVersion: string;
  }) {
    const phone = normalizePhoneBR(payload.phone);
    if (!phone) throw new UnauthorizedException('Telefone inválido');

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new UnauthorizedException('Telefone já cadastrado');
    if (Number.isNaN(payload.birthDate.getTime()) || !isAtLeast18(payload.birthDate)) {
      throw new BadRequestException({
        error: 'underage',
        message: 'Precisa ter 18 anos ou mais pra usar o Metch',
      });
    }
    // sem código de SMS confirmado não existe conta: nada de cadastrar o número dos outros
    const proof = await this.redis.consumeSignupProof(phone);
    if (!proof) throw new UnauthorizedException('Confirma o código do SMS antes de criar a conta');

    const id = uuid();
    const user = await this.prisma.user.create({
      data: {
        id,
        phone,
        name: payload.name,
        birthDate: payload.birthDate,
        gender: payload.gender as never,
        orientation: (payload.orientation ?? undefined) as never,
        lookingFor: (payload.lookingFor ?? 'unspecified') as never,
        // avatar inicial determinístico (seed = id → mesmo visual em qualquer cliente)
        avatarConfig: randomAvatarConfig(id, {
          gender: payload.gender as 'female' | 'male' | 'non_binary' | 'other',
        }) as never,
        // completude inicial: nome (10) + intenção definida (5) — resto vem de fotos/bio/interesses
        profileCompleteness:
          10 + (payload.lookingFor && payload.lookingFor !== 'unspecified' ? 5 : 0),
        termsVersion: payload.termsVersion,
        termsAcceptedAt: new Date(),
      },
    });
    return this.issueTokens(user.id, phone);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify(refreshToken, { secret: this.cfg.get('jwt.secret') }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
    if (!canRenewWith(payload)) throw new UnauthorizedException('Refresh token inválido');
    // fora do try: conta banida/suspensa responde 403 com o motivo (não "token inválido")
    return this.issueTokens(payload.sub, payload.phone);
  }

  async logout(userId: string): Promise<void> {
    await this.redis.client.del(`profile:${userId}`);
  }

  private async issueTokens(userId: string, phone?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Usuário não encontrado');
    // banida/suspensa não ganha token novo (login e refresh): 403 com o motivo, que o app mostra
    await this.accounts.assertActive(userId);

    const base = { sub: userId, phone: phone ?? user.phone ?? undefined };
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

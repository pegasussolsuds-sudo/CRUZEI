import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from './sms.service';
import { normalizePhoneBR, randomAvatarConfig } from '@cruzei/shared-utils';
import { v4 as uuid } from 'uuid';

export interface JwtPayload {
  sub: string; // userId
  phone?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly sms: SmsService,
    private readonly redis: RedisService,
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
  }) {
    const phone = normalizePhoneBR(payload.phone);
    if (!phone) throw new UnauthorizedException('Telefone inválido');

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new UnauthorizedException('Telefone já cadastrado');

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
        avatarConfig: randomAvatarConfig(id, { gender: payload.gender as 'female' | 'male' | 'non_binary' | 'other' }) as never,
        // completude inicial: nome (10) + intenção definida (5) — resto vem de fotos/bio/interesses
        profileCompleteness: 10 + (payload.lookingFor && payload.lookingFor !== 'unspecified' ? 5 : 0),
      },
    });
    return this.issueTokens(user.id, phone);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, { secret: this.cfg.get('jwt.secret') }) as JwtPayload;
      return this.issueTokens(payload.sub, payload.phone);
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.redis.client.del(`profile:${userId}`);
  }

  private async issueTokens(userId: string, phone?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    const payload: JwtPayload = { sub: userId, phone: phone ?? user.phone ?? undefined };
    const accessTtl = this.cfg.get<number>('jwt.accessTtl') ?? 900;
    const refreshTtl = this.cfg.get<number>('jwt.refreshTtl') ?? 2_592_000;

    const token = this.jwt.sign(payload, { expiresIn: accessTtl });
    const refreshToken = this.jwt.sign(payload, { expiresIn: refreshTtl });

    return {
      user: { id: user.id, name: user.name, phone: user.phone, isNew: false },
      token,
      refreshToken,
    };
  }
}

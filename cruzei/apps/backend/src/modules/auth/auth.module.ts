import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AnalyticsModule } from '../analytics/analytics.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PhoneReleaseService } from './phone-release.service';
import { createSmsProvider } from './sms/create-sms-provider';
import { loadSmsConfig, SMS_CONFIG, type SmsConfig } from './sms/sms-config';
import { SMS_PROVIDER } from './sms/sms-provider';
import { SmsService } from './sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    // signup_done + eventos anônimos do cadastro ligados à conta (RegisterRequest.installId)
    AnalyticsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('jwt.secret'),
        signOptions: { expiresIn: cfg.get<number>('jwt.accessTtl') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SmsService,
    PhoneReleaseService,
    // SMS: config errada (driver, credenciais, número de revisão) derruba o boot; o provedor sai do SMS_DRIVER
    { provide: SMS_CONFIG, useFactory: () => loadSmsConfig(process.env) },
    {
      provide: SMS_PROVIDER,
      inject: [SMS_CONFIG],
      useFactory: (c: SmsConfig) => createSmsProvider(c),
    },
  ],
  // PhoneReleaseService: o painel admin usa a mesma liberação ("Liberar número", só admin)
  exports: [AuthService, JwtModule, PhoneReleaseService],
})
export class AuthModule {}

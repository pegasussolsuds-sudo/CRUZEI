import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  validateSync,
} from 'class-validator';

import { smsEnvProblems } from '../modules/auth/sms/sms-config';
import { missingLegalEnv } from '../modules/legal/legal.service';
import { photoModerationMode } from '../modules/moderation/photo-rules';
import {
  StorageConfigError,
  storageConfigFromEnv,
} from '../modules/uploads/storage/object-storage';

import {
  allowedOriginsVar,
  appEnv,
  parseOrigins,
  productionProblems,
  resolveAllowedOrigins,
} from './security';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/** flag true|false: vazio conta como ausente; '1', 'yes' etc. derrubam o boot (valor ambíguo) */
const optionalFlag = (_o: object, v: unknown) => v !== undefined && v !== null && v !== '';

class EnvVars {
  // obrigatório e sem padrão: sem ele o servidor não sobe (ausente nunca vira development)
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  // atalhos de dev (devCode, código do SMS no log, recibo 'dev'): só com NODE_ENV=development
  @ValidateIf(optionalFlag)
  @IsIn(['true', 'false'])
  DEV_SHORTCUTS?: string;

  // recibo 'dev' aceito em qualquer ambiente (beta fechado); em produção avisa em todo boot
  @ValidateIf(optionalFlag)
  @IsIn(['true', 'false'])
  ALLOW_DEV_RECEIPTS?: string;

  // origens de navegador aceitas (HTTP e socket), separadas por vírgula; CORS_ORIGINS é o nome legado
  @IsString()
  @IsOptional()
  ALLOWED_ORIGINS?: string;

  @IsNumber()
  PORT: number = 3000;

  @IsString()
  API_PREFIX: string = 'v1';

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  // Sal da posição borrada (/nearby, /users/:id). Opcional, mas sem ele o deslocamento é previsível.
  @IsString()
  @IsOptional()
  LOCATION_SALT?: string;

  // moderação de fotos: off (só dev) | manual (fila humana) | rekognition (AWS + fila humana pro que não é claro)
  @IsIn(['off', 'manual', 'rekognition'])
  @IsOptional()
  PHOTO_MODERATION?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  // antes do class-validator: mensagem clara (e o @nestjs/config não grava um 'development' inventado no process.env)
  if (!String(config.NODE_ENV ?? '').trim())
    throw new Error('Config inválida: NODE_ENV ausente — defina development, test ou production');
  const validatedConfig = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Config inválida: ${errors.toString()}`);
  }
  const log = new Logger('Config');
  const env = config as NodeJS.ProcessEnv;
  if (validatedConfig.DEV_SHORTCUTS === 'true' && validatedConfig.NODE_ENV !== NodeEnv.Development)
    throw new Error(
      `Config inválida: DEV_SHORTCUTS=true só vale com NODE_ENV=development (veio ${validatedConfig.NODE_ENV})`,
    );
  // SMS (driver, credenciais, número de revisão, tetos): errado não sobe em nenhum ambiente; produção exige
  // twilio ou zenvia. Aqui (e não só no AuthModule) pra barrar também o primário do cluster
  const sms = smsEnvProblems(env);
  if (sms.length) throw new Error(`Config de SMS inválida: ${sms.join('; ')}`);
  // storage das fotos (STORAGE_*): mesma regra do provider do UploadsModule, aqui pra barrar também o primário
  try {
    storageConfigFromEnv(env);
  } catch (e) {
    if (e instanceof StorageConfigError) throw new Error(e.message);
    throw e;
  }
  if (validatedConfig.NODE_ENV === NodeEnv.Production) {
    // produção falha fechada: sem moderação de fotos, sem os dados da empresa nos Termos/Política, com segredo
    // fraco/repetido, origem inválida ou senha de exemplo do banco, não sobe. Mensagem só com nomes, nunca valores.
    const problems: string[] = [];
    if (photoModerationMode(config as NodeJS.ProcessEnv) === 'off')
      problems.push('PHOTO_MODERATION=off (use manual ou rekognition)');
    const legal = missingLegalEnv(config as NodeJS.ProcessEnv);
    if (legal.length) problems.push(`dados legais ausentes: ${legal.join(', ')}`);
    // JWT_SECRET, LOCATION_SALT e PHONE_HASH_SECRET (≥ 32, fora de exemplo, distintos), origens https e senha do banco
    problems.push(...productionProblems(env));
    if (problems.length) throw new Error(`Config de produção insegura: ${problems.join('; ')}`);
    if (validatedConfig.ALLOW_DEV_RECEIPTS === 'true')
      log.warn(
        'ALLOW_DEV_RECEIPTS=true em produção: qualquer um ativa Premium/Boost sem pagar (só pra beta fechado)',
      );
    if (!(Number(env.TRUST_PROXY_HOPS ?? 0) > 0))
      log.warn(
        'TRUST_PROXY_HOPS ausente ou 0 em produção: atrás de proxy, req.ip é o do proxy (tetos por IP e registros de acesso erram)',
      );
  } else {
    if (!validatedConfig.LOCATION_SALT)
      log.warn(
        'LOCATION_SALT ausente — usando salt padrão de dev pra borrar posições. Produção exige um valor aleatório.',
      );
    if (validatedConfig.DEV_SHORTCUTS === 'true')
      log.warn(
        'DEV_SHORTCUTS=true: código do SMS no log e na resposta, recibo "dev" aceito (só desenvolvimento)',
      );
    const originsVar = allowedOriginsVar(env);
    const bad = originsVar ? parseOrigins(env[originsVar]).invalid : [];
    if (bad.length)
      log.warn(
        `${originsVar} com entrada ignorada (origem exata, sem '*' ou path): ${bad.join(', ')}`,
      );
  }
  return validatedConfig;
}

export const configuration = () => ({
  env: appEnv(),
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'v1',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
  },
  // número reciclado: conta parada há >= dormantDays pede "Essa conta é sua?" no login (0 desliga)
  auth: {
    dormantDays: parseInt(process.env.AUTH_DORMANT_DAYS ?? '90', 10),
    claimMaxAttempts: parseInt(process.env.AUTH_CLAIM_MAX_ATTEMPTS ?? '3', 10),
  },
  // origens de navegador (HTTP e socket): ALLOWED_ORIGINS (ou CORS_ORIGINS legado); ver config/security
  corsOrigins: resolveAllowedOrigins(),
  locationSalt: process.env.LOCATION_SALT,
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
});

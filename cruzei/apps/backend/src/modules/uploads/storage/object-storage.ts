// Camada de storage das fotos: driver 'local' (UPLOAD_DIR, padrão) ou 's3' (R2/S3 com SigV4 próprio, sem SDK).
// A config sai do env e é validada no boot (o provider do UploadsModule chama storageConfigFromEnv).
import { photoBaseUrl } from '../../../common/photo-url';
import { isProduction } from '../../../config/security';
import { UPLOAD_DIR } from '../uploads.constants';

import { LocalObjectStorage } from './local-storage';
import { S3ObjectStorage, type S3Deps } from './s3-storage';

export { assertKey } from './assert-key';

export interface PutOptions {
  /** sobrescreve o Cache-Control público (STORAGE_CACHE_CONTROL); a foto retida vai com PRIVATE_CACHE_CONTROL */
  cacheControl?: string;
}

/** objeto que nunca pode parar em cache de CDN/navegador (foto retida por denúncia, held/) */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

export interface ObjectStorage {
  readonly driver: StorageDriver;
  put(key: string, body: Buffer, contentType: string, opts?: PutOptions): Promise<void>;
  /** null quando não existe */
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** idempotente: apagar o que não existe não é erro */
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = 'OBJECT_STORAGE';

export type StorageDriver = 'local' | 's3';
export type StorageGcMode = 'on' | 'dry' | 'off';

export const DEFAULT_CACHE_CONTROL = 'public, max-age=86400, immutable';

export interface StorageConfig {
  driver: StorageDriver;
  publicBaseUrl: string;
  gc: StorageGcMode;
  cacheControl: string;
  localDir: string;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  /** avisos de boot (não impedem subir) */
  warnings: string[];
}

export class StorageConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Config de storage inválida: ${problems.join('; ')}`);
    this.name = 'StorageConfigError';
  }
}

function isHttpUrl(v: string, httpsOnly: boolean): boolean {
  try {
    const u = new URL(v);
    return httpsOnly ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** lê e valida STORAGE_*; lança StorageConfigError com a lista de problemas (sem nunca ecoar segredo) */
export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const problems: string[] = [];
  const warnings: string[] = [];
  // ausente/desconhecido conta como produção (mesma regra das travas de produção)
  const prod = isProduction(env);

  const driverRaw = (env.STORAGE_DRIVER ?? 'local').trim().toLowerCase() || 'local';
  if (driverRaw !== 'local' && driverRaw !== 's3')
    problems.push('STORAGE_DRIVER precisa ser local ou s3');
  const driver: StorageDriver = driverRaw === 's3' ? 's3' : 'local';

  const gcRaw = (env.STORAGE_GC ?? 'on').trim().toLowerCase() || 'on';
  if (!['on', 'dry', 'off'].includes(gcRaw)) problems.push('STORAGE_GC precisa ser on, dry ou off');
  const gc = (['on', 'dry', 'off'].includes(gcRaw) ? gcRaw : 'on') as StorageGcMode;

  const baseRaw = (env.STORAGE_PUBLIC_BASE_URL ?? '').trim();
  if (baseRaw && !isHttpUrl(baseRaw, false))
    problems.push('STORAGE_PUBLIC_BASE_URL precisa ser uma URL http(s)');
  if (prod && !baseRaw) problems.push('STORAGE_PUBLIC_BASE_URL é obrigatória em produção');
  else if (prod && !isHttpUrl(baseRaw, true))
    problems.push('STORAGE_PUBLIC_BASE_URL precisa ser https em produção');
  if (driver === 's3' && !baseRaw)
    problems.push('STORAGE_DRIVER=s3 exige STORAGE_PUBLIC_BASE_URL (domínio público do bucket)');

  let s3: StorageConfig['s3'];
  if (driver === 's3') {
    const endpoint = (env.STORAGE_S3_ENDPOINT ?? '').trim().replace(/\/+$/, '');
    const bucket = (env.STORAGE_S3_BUCKET ?? '').trim();
    const accessKeyId = (env.STORAGE_S3_ACCESS_KEY_ID ?? '').trim();
    const secretAccessKey = (env.STORAGE_S3_SECRET_ACCESS_KEY ?? '').trim();
    if (!endpoint) problems.push('STORAGE_S3_ENDPOINT ausente');
    else if (!isHttpUrl(endpoint, prod))
      problems.push(
        prod ? 'STORAGE_S3_ENDPOINT precisa ser https em produção' : 'STORAGE_S3_ENDPOINT inválido',
      );
    if (!bucket) problems.push('STORAGE_S3_BUCKET ausente');
    else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
      problems.push('STORAGE_S3_BUCKET com nome inválido');
    if (!accessKeyId) problems.push('STORAGE_S3_ACCESS_KEY_ID ausente');
    if (!secretAccessKey) problems.push('STORAGE_S3_SECRET_ACCESS_KEY ausente');
    s3 = {
      endpoint,
      region: (env.STORAGE_S3_REGION ?? '').trim() || 'auto',
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: (env.STORAGE_S3_FORCE_PATH_STYLE ?? 'true').trim().toLowerCase() !== 'false',
    };
  } else if (prod) {
    warnings.push(
      'STORAGE_DRIVER=local em produção: as fotos ficam no disco deste servidor (um host só, sem CDN)',
    );
  }

  if (problems.length) throw new StorageConfigError(problems);
  return {
    driver,
    publicBaseUrl: photoBaseUrl(env),
    gc,
    cacheControl: (env.STORAGE_CACHE_CONTROL ?? '').trim() || DEFAULT_CACHE_CONTROL,
    localDir: env.UPLOAD_DIR || UPLOAD_DIR,
    s3,
    warnings,
  };
}

export function createObjectStorage(cfg: StorageConfig, deps: S3Deps = {}): ObjectStorage {
  if (cfg.driver === 's3' && cfg.s3) {
    return new S3ObjectStorage({ ...cfg.s3, cacheControl: cfg.cacheControl }, deps);
  }
  return new LocalObjectStorage(cfg.localDir);
}

let shared: ObjectStorage | null = null;

/** instância única do processo (o provider do Nest e os scripts usam a mesma) */
export function sharedObjectStorage(): ObjectStorage {
  shared ??= createObjectStorage(storageConfigFromEnv());
  return shared;
}

/** testes */
export function resetSharedObjectStorage(): void {
  shared = null;
}

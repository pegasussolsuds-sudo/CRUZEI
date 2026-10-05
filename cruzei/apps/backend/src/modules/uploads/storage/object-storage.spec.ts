import { resetPhotoUrlCache } from '../../../common/photo-url';

import { LocalObjectStorage } from './local-storage';
import {
  createObjectStorage,
  DEFAULT_CACHE_CONTROL,
  StorageConfigError,
  storageConfigFromEnv,
} from './object-storage';
import { S3ObjectStorage } from './s3-storage';

// Config do storage lida do env e validada no boot: produção sem base https ou s3 sem credencial não sobe.

const S3_OK = {
  STORAGE_DRIVER: 's3',
  STORAGE_PUBLIC_BASE_URL: 'https://fotos.metch.app',
  STORAGE_S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
  STORAGE_S3_BUCKET: 'metch-fotos',
  STORAGE_S3_ACCESS_KEY_ID: 'AKID',
  STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-que-nao-pode-aparecer',
};

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    storageConfigFromEnv(env);
  } catch (e) {
    expect(e).toBeInstanceOf(StorageConfigError);
    return (e as StorageConfigError).problems;
  }
  return [];
}

afterAll(() => resetPhotoUrlCache());

describe('storageConfigFromEnv', () => {
  it('dev sem nada: local, base 127.0.0.1/uploads, GC on, cache padrão', () => {
    const cfg = storageConfigFromEnv({ NODE_ENV: 'development', UPLOAD_DIR: '/tmp/up' });
    expect(cfg).toMatchObject({
      driver: 'local',
      publicBaseUrl: 'http://127.0.0.1:3000/uploads',
      gc: 'on',
      cacheControl: DEFAULT_CACHE_CONTROL,
      localDir: '/tmp/up',
      warnings: [],
    });
    expect(cfg.s3).toBeUndefined();
  });

  it('produção exige STORAGE_PUBLIC_BASE_URL https; local em produção só avisa', () => {
    expect(problemsOf({ NODE_ENV: 'production' })).toContain(
      'STORAGE_PUBLIC_BASE_URL é obrigatória em produção',
    );
    expect(
      problemsOf({ NODE_ENV: 'production', STORAGE_PUBLIC_BASE_URL: 'http://fotos.metch.app' }),
    ).toContain('STORAGE_PUBLIC_BASE_URL precisa ser https em produção');
    const cfg = storageConfigFromEnv({
      NODE_ENV: 'production',
      STORAGE_PUBLIC_BASE_URL: 'https://api.metch.app/uploads',
    });
    expect(cfg.driver).toBe('local');
    expect(cfg.warnings.join(' ')).toMatch(/disco deste servidor/);
  });

  it('NODE_ENV ausente ou desconhecido conta como produção', () => {
    expect(problemsOf({})).toContain('STORAGE_PUBLIC_BASE_URL é obrigatória em produção');
    expect(problemsOf({ NODE_ENV: 'staging' })).toContain(
      'STORAGE_PUBLIC_BASE_URL é obrigatória em produção',
    );
  });

  it('s3 completo: região auto e path-style por padrão', () => {
    const cfg = storageConfigFromEnv({ NODE_ENV: 'production', ...S3_OK });
    expect(cfg.driver).toBe('s3');
    expect(cfg.publicBaseUrl).toBe('https://fotos.metch.app');
    expect(cfg.s3).toMatchObject({ region: 'auto', bucket: 'metch-fotos', forcePathStyle: true });
    expect(
      storageConfigFromEnv({
        NODE_ENV: 'production',
        ...S3_OK,
        STORAGE_S3_FORCE_PATH_STYLE: 'false',
      }).s3?.forcePathStyle,
    ).toBe(false);
  });

  it('s3 incompleto lista todos os problemas e nunca ecoa o segredo', () => {
    const p = problemsOf({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      STORAGE_S3_ENDPOINT: 'http://inseguro.example',
      STORAGE_S3_BUCKET: 'Bucket_Invalido',
      STORAGE_S3_SECRET_ACCESS_KEY: 'segredo-que-nao-pode-aparecer',
    });
    expect(p).toEqual(
      expect.arrayContaining([
        'STORAGE_PUBLIC_BASE_URL é obrigatória em produção',
        'STORAGE_DRIVER=s3 exige STORAGE_PUBLIC_BASE_URL (domínio público do bucket)',
        'STORAGE_S3_ENDPOINT precisa ser https em produção',
        'STORAGE_S3_BUCKET com nome inválido',
        'STORAGE_S3_ACCESS_KEY_ID ausente',
      ]),
    );
    expect(p.join(' ')).not.toContain('segredo-que-nao-pode-aparecer');
  });

  it('driver e modo de GC desconhecidos são erro', () => {
    expect(problemsOf({ NODE_ENV: 'development', STORAGE_DRIVER: 'gcs' })).toContain(
      'STORAGE_DRIVER precisa ser local ou s3',
    );
    expect(problemsOf({ NODE_ENV: 'development', STORAGE_GC: 'talvez' })).toContain(
      'STORAGE_GC precisa ser on, dry ou off',
    );
    expect(storageConfigFromEnv({ NODE_ENV: 'development', STORAGE_GC: 'DRY' }).gc).toBe('dry');
  });

  it('createObjectStorage escolhe o driver', () => {
    expect(createObjectStorage(storageConfigFromEnv({ NODE_ENV: 'test' }))).toBeInstanceOf(
      LocalObjectStorage,
    );
    expect(
      createObjectStorage(storageConfigFromEnv({ NODE_ENV: 'production', ...S3_OK })),
    ).toBeInstanceOf(S3ObjectStorage);
  });
});

import {
  HELD_PREFIX,
  imageContentType,
  isHeldKey,
  isManagedKey,
  isValidKey,
  keyFromPhotoUrl,
  newHeldKey,
  newPhotoKeys,
  photoBaseHost,
  photoBaseUrl,
  photoUrl,
  resetPhotoUrlCache,
} from './photo-url';

const UUID = '3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b';

describe('photo-url — chaves', () => {
  it('upload novo: p/<uuid>.jpg e p/<uuid>-t.jpg (gerenciadas e válidas)', () => {
    const { key, thumbKey } = newPhotoKeys();
    expect(key).toMatch(/^p\/[0-9a-f-]{36}\.jpg$/);
    expect(thumbKey).toBe(key.replace('.jpg', '-t.jpg'));
    expect(isManagedKey(key)).toBe(true);
    expect(isManagedKey(thumbKey)).toBe(true);
    expect(newPhotoKeys().key).not.toBe(key);
  });

  it('isValidKey barra traversal, barra dupla, maiúscula, absoluto e tamanho', () => {
    expect(isValidKey(`p/${UUID}.jpg`)).toBe(true);
    expect(isValidKey('fakes/fake-1.jpg')).toBe(true);
    for (const bad of [
      '',
      '../x.jpg',
      'p/../x.jpg',
      'p//x.jpg',
      '/p/x.jpg',
      'P/X.JPG',
      'p/x',
      'p\\x.jpg',
      'x'.repeat(201) + '.jpg',
      42,
      null,
    ]) {
      expect(isValidKey(bad)).toBe(false);
    }
  });

  it('isManagedKey: só uuid nosso (novo em p/ ou legado na raiz); fakes/ e nomes livres nunca', () => {
    expect(isManagedKey(`${UUID}.png`)).toBe(true);
    expect(isManagedKey(`${UUID}-t.jpg`)).toBe(true);
    expect(isManagedKey(`p/${UUID}-t.jpg`)).toBe(true);
    expect(isManagedKey('fakes/fake-1.jpg')).toBe(false);
    expect(isManagedKey(`fakes/${UUID}.jpg`)).toBe(false);
    expect(isManagedKey(`p/${UUID}-t.png`)).toBe(false);
    expect(isManagedKey(`https://cdn.x/${UUID}.jpg`)).toBe(false);
  });

  it('held/: cópia privada da foto retida é gerenciada (o GC apaga quando a retenção acaba)', () => {
    expect(isManagedKey(`held/${UUID}.jpg`)).toBe(true);
    expect(isManagedKey(`held/${UUID}.png`)).toBe(true);
    expect(isHeldKey(`held/${UUID}.jpg`)).toBe(true);
    expect(isHeldKey(`p/${UUID}.jpg`)).toBe(false);
    expect(isHeldKey(null)).toBe(false);
    expect(isManagedKey(`held/x/${UUID}.jpg`)).toBe(false);
    expect(HELD_PREFIX).toBe('held/');
  });

  it('newHeldKey: uuid NOVO (a URL pública antiga não leva até ela) e a extensão do original', () => {
    const a = newHeldKey(`p/${UUID}.jpg`);
    expect(a).toMatch(/^held\/[0-9a-f-]{36}\.jpg$/);
    expect(a).not.toContain(UUID);
    expect(newHeldKey(`p/${UUID}.jpg`)).not.toBe(a);
    expect(newHeldKey(`${UUID}.png`)).toMatch(/\.png$/);
    expect(newHeldKey(`${UUID}.webp`)).toMatch(/\.webp$/);
    // extensão estranha vira jpg
    expect(newHeldKey(`${UUID}.bin`)).toMatch(/\.jpg$/);
    expect(isManagedKey(a)).toBe(true);
  });

  it('imageContentType pela extensão; desconhecida → octet-stream', () => {
    expect(imageContentType(`held/${UUID}.jpg`)).toBe('image/jpeg');
    expect(imageContentType(`${UUID}.PNG`)).toBe('image/png');
    expect(imageContentType(`${UUID}.heic`)).toBe('image/heic');
    expect(imageContentType('x.html')).toBe('application/octet-stream');
  });
});

describe('photo-url — URL pública', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['STORAGE_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL', 'PORT']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetPhotoUrlCache();
  });

  const useBase = (base: string | undefined) => {
    if (base === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
    else process.env.STORAGE_PUBLIC_BASE_URL = base;
    resetPhotoUrlCache();
  };

  it('base: STORAGE_PUBLIC_BASE_URL sem barra final; dev cai em PUBLIC_BASE_URL/uploads ou 127.0.0.1', () => {
    expect(photoBaseUrl({ STORAGE_PUBLIC_BASE_URL: 'https://fotos.metch.app//' })).toBe(
      'https://fotos.metch.app',
    );
    expect(photoBaseUrl({ PUBLIC_BASE_URL: 'http://192.168.0.9:3000/' })).toBe(
      'http://192.168.0.9:3000/uploads',
    );
    expect(photoBaseUrl({ PORT: '4000' })).toBe('http://127.0.0.1:4000/uploads');
    expect(photoBaseUrl({})).toBe('http://127.0.0.1:3000/uploads');
    expect(photoBaseHost({ STORAGE_PUBLIC_BASE_URL: 'https://Fotos.Metch.app' })).toBe(
      'fotos.metch.app',
    );
  });

  it('chave vira base + segmentos codificados; URL absoluta (legado/externa) passa igual; null → null', () => {
    useBase('https://fotos.metch.app');
    expect(photoUrl(`p/${UUID}.jpg`)).toBe(`https://fotos.metch.app/p/${UUID}.jpg`);
    expect(photoUrl('fakes/fake 1.jpg')).toBe('https://fotos.metch.app/fakes/fake%201.jpg');
    expect(photoUrl('http://192.168.0.9:3000/uploads/a.jpg')).toBe(
      'http://192.168.0.9:3000/uploads/a.jpg',
    );
    expect(photoUrl('https://cdn.externo/x.jpg')).toBe('https://cdn.externo/x.jpg');
    expect(photoUrl(null)).toBeNull();
    expect(photoUrl(undefined)).toBeNull();
    expect(photoUrl('')).toBeNull();
  });

  it('caminho estranho não monta URL', () => {
    useBase('https://fotos.metch.app');
    for (const bad of ['/etc/passwd', '../x.jpg', 'p//x.jpg', 'p\\x.jpg'])
      expect(photoUrl(bad)).toBeNull();
  });

  it('foto retida (held/) nunca vira URL pública', () => {
    useBase('https://fotos.metch.app');
    expect(photoUrl(`held/${UUID}.jpg`)).toBeNull();
    expect(photoUrl(`p/${UUID}.jpg`)).not.toBeNull();
  });

  it('a base fica em cache até resetPhotoUrlCache (lida uma vez por processo)', () => {
    useBase('https://a.example');
    expect(photoUrl('k.jpg')).toBe('https://a.example/k.jpg');
    process.env.STORAGE_PUBLIC_BASE_URL = 'https://b.example';
    expect(photoUrl('k.jpg')).toBe('https://a.example/k.jpg');
    resetPhotoUrlCache();
    expect(photoUrl('k.jpg')).toBe('https://b.example/k.jpg');
  });
});

describe('photo-url — keyFromPhotoUrl', () => {
  beforeEach(() => {
    process.env.STORAGE_PUBLIC_BASE_URL = 'https://fotos.metch.app';
    resetPhotoUrlCache();
  });
  afterAll(() => {
    delete process.env.STORAGE_PUBLIC_BASE_URL;
    resetPhotoUrlCache();
  });

  it('aceita a chave, a URL da base e o legado /uploads/ de qualquer host', () => {
    const key = `p/${UUID}.jpg`;
    expect(keyFromPhotoUrl(key)).toBe(key);
    expect(keyFromPhotoUrl(`https://fotos.metch.app/${key}`)).toBe(key);
    expect(keyFromPhotoUrl(`http://192.168.0.9:3000/uploads/${key}`)).toBe(key);
    expect(keyFromPhotoUrl(`http://127.0.0.1:3000/uploads/${UUID}.png`)).toBe(`${UUID}.png`);
    expect(keyFromPhotoUrl('https://fotos.metch.app/fakes/fake%2D1.jpg')).toBe('fakes/fake-1.jpg');
  });

  it('recusa query, fragmento, credencial, traversal (inclusive codificado), outro caminho e lixo', () => {
    for (const bad of [
      `https://fotos.metch.app/p/${UUID}.jpg?x=1`,
      `https://fotos.metch.app/p/${UUID}.jpg#a`,
      `http://user:pw@evil/uploads/p/${UUID}.jpg`,
      'http://evil/uploads/..%2F..%2Fetc%2Fpasswd',
      'http://evil/uploads/p%2F..%2Fx.jpg',
      'https://fotos.metch.app/%E0%A4%A',
      'https://evil.example/p/x.jpg',
      'https://fotos.metch.app.evil.example/p/x.jpg',
      '../x.jpg',
      null,
      undefined,
      `https://fotos.metch.app/${'a'.repeat(1001)}.jpg`,
    ]) {
      expect(keyFromPhotoUrl(bad)).toBeNull();
    }
  });
});

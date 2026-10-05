import sharp from 'sharp';

import {
  PhotoBusy,
  PhotoProcessingUnavailable,
  PhotoRejected,
  processPhoto,
} from './image-pipeline';
import type { SharpFactory } from './thumbnails';

// Reprocessamento das fotos com o sharp DE VERDADE: o strip de metadado é comprovado lendo o resultado de volta
// (sharp.metadata) e procurando os textos plantados nos bytes crus do JPEG final.

const SECRET = {
  make: 'MotorolaSecreta',
  datum: 'WGS-84-SECRETO',
  comment: 'comentario-exif-secreto',
  xmp: 'xmp-gps-secreto',
  iptc: 'legenda-iptc-secreta',
  com: 'comentario-jpeg-secreto',
};
const XMP =
  '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="18,55.12S" exif:GPSAreaInformation="${SECRET.xmp}"/>` +
  '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/** APP13 (IPTC no bloco Photoshop) + COM logo depois do SOI: o sharp não grava esses, então monta à mão */
function withIptcAndComment(jpeg: Buffer): Buffer {
  const text = Buffer.from(SECRET.iptc);
  const iptc = Buffer.concat([Buffer.from([0x1c, 0x02, 0x78, 0x00, text.length]), text]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(iptc.length);
  let ps = Buffer.concat([
    Buffer.from('Photoshop 3.0\0', 'latin1'),
    Buffer.from('8BIM'),
    Buffer.from([0x04, 0x04, 0, 0]),
    size,
    iptc,
  ]);
  if (ps.length % 2) ps = Buffer.concat([ps, Buffer.from([0])]);
  const len = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n + 2);
    return b;
  };
  const com = Buffer.from(SECRET.com);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, 0xed]),
    len(ps.length),
    ps,
    Buffer.from([0xff, 0xfe]),
    len(com.length),
    com,
    jpeg.subarray(2),
  ]);
}

/** JPEG de celular: 40x20 com Orientation=6 (girar 90°), EXIF com aparelho e GPS, XMP, perfil P3, IPTC e comentário */
async function phoneJpeg(): Promise<Buffer> {
  const raw = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: SECRET.make, Model: 'moto g54 5G', Software: 'Camera 9.1' },
      IFD2: { DateTimeOriginal: '2026:10:05 03:14:15', UserComment: SECRET.comment },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '18/1 55/1 7/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '48/1 16/1 38/1',
        GPSMapDatum: SECRET.datum,
      },
    })
    .withXmp(XMP)
    .withIccProfile('p3')
    .toBuffer();
  return withIptcAndComment(raw);
}

const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** nenhum metadado no resultado, nem lido pelo sharp nem nos bytes crus */
async function expectClean(out: Buffer) {
  const m = await sharp(out).metadata();
  expect(m.format).toBe('jpeg');
  expect(m.exif).toBeUndefined();
  expect(m.xmp).toBeUndefined();
  expect(m.iptc).toBeUndefined();
  expect(m.icc).toBeUndefined();
  expect(m.orientation).toBeUndefined();
  for (const s of [
    ...Object.values(SECRET),
    'Exif',
    'GPS',
    'xmpmeta',
    'Photoshop',
    '8BIM',
    'ICC_PROFILE',
  ]) {
    expect(out.includes(Buffer.from(s))).toBe(false);
  }
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('era pra ter falhado');
}

describe('processPhoto — strip de metadado', () => {
  it('a entrada de teste tem mesmo tudo plantado (controle)', async () => {
    const input = await phoneJpeg();
    const m = await sharp(input).metadata();
    expect(m.orientation).toBe(6);
    expect(m.exif?.includes(Buffer.from(SECRET.datum))).toBe(true);
    expect(m.exif?.includes(Buffer.from(SECRET.make))).toBe(true);
    expect(m.xmp?.includes(Buffer.from(SECRET.xmp))).toBe(true);
    expect(m.icc).toBeDefined();
    expect(m.iptc?.includes(Buffer.from(SECRET.iptc))).toBe(true);
    expect(input.includes(Buffer.from(SECRET.com))).toBe(true);
  });

  it('JPEG de celular: gira pelo EXIF e sai sem EXIF, GPS, XMP, IPTC, ICC nem comentário (foto e miniatura)', async () => {
    const out = await processPhoto(await phoneJpeg());
    // Orientation=6: 40x20 vira 20x40 e a tag some
    expect([out.width, out.height]).toEqual([20, 40]);
    expect(out.inputFormat).toBe('jpeg');
    expect(isJpeg(out.main)).toBe(true);
    expect(out.bytes).toBe(out.main.length);
    await expectClean(out.main);
    await expectClean(out.thumb);
    const t = await sharp(out.thumb).metadata();
    expect([t.width, t.height]).toEqual([256, 256]);
    expect((await sharp(out.main).metadata()).space).toBe('srgb');
  });

  it('PNG e WebP com EXIF/GPS também saem limpos, sempre em JPEG', async () => {
    const png = await sharp({
      create: { width: 30, height: 30, channels: 3, background: '#336699' },
    })
      .png()
      .withExif({ IFD3: { GPSMapDatum: SECRET.datum } })
      .toBuffer();
    const webp = await sharp({
      create: { width: 30, height: 30, channels: 3, background: '#996633' },
    })
      .webp()
      .withExif({ IFD0: { Make: SECRET.make } })
      .toBuffer();
    expect((await sharp(png).metadata()).exif).toBeDefined();
    expect((await sharp(webp).metadata()).exif).toBeDefined();
    for (const [input, fmt] of [
      [png, 'png'],
      [webp, 'webp'],
    ] as const) {
      const out = await processPhoto(input);
      expect(out.inputFormat).toBe(fmt);
      await expectClean(out.main);
      await expectClean(out.thumb);
    }
  });
});

describe('processPhoto — tipo pelo conteúdo', () => {
  it('HTML ou texto com nome/tipo de imagem: photo_invalid (o mimetype do cliente não vale)', async () => {
    for (const s of [
      '<html><script>alert(1)</script></html>',
      'GIF89a<script>alert(1)</script>',
      'oi',
    ]) {
      const e = await errorOf(processPhoto(Buffer.from(s)));
      expect(e).toBeInstanceOf(PhotoRejected);
      expect((e as PhotoRejected).code).toBe('photo_invalid');
    }
  });

  it('SVG (com script) e TIFF: formato fora da lista = photo_invalid', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    const tiff = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00f' } })
      .tiff()
      .toBuffer();
    for (const input of [svg, tiff]) {
      const e = await errorOf(processPhoto(input));
      expect((e as PhotoRejected).code).toBe('photo_invalid');
    }
  });

  it('arquivo vazio: photo_invalid', async () => {
    expect(((await errorOf(processPhoto(Buffer.alloc(0)))) as PhotoRejected).code).toBe(
      'photo_invalid',
    );
  });

  it('JPEG truncado: photo_invalid', async () => {
    const full = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#0a0' },
    })
      .jpeg()
      .toBuffer();
    const e = await errorOf(processPhoto(full.subarray(0, 40)));
    expect(e).toBeInstanceOf(PhotoRejected);
  });

  it('AVIF (heif/av1) é aceito; HEIC (heif/hevc) dá photo_unsupported', async () => {
    const avif = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#0f0' } })
      .avif()
      .toBuffer();
    const out = await processPhoto(avif);
    expect(out.inputFormat).toBe('heif');
    expect(isJpeg(out.main)).toBe(true);

    // o sharp pré-compilado não decodifica HEVC: metadata falsa basta pra regra
    const heic = (() => ({
      metadata: async () => ({ format: 'heif', compression: 'hevc', width: 100, height: 100 }),
    })) as unknown as SharpFactory;
    const e = await errorOf(processPhoto(Buffer.from('heic'), { loadSharp: () => heic }));
    expect((e as PhotoRejected).code).toBe('photo_unsupported');
  });

  it('GIF animado: só o 1º quadro vira foto', async () => {
    const frame = (c: string) =>
      sharp({ create: { width: 30, height: 20, channels: 3, background: c } })
        .png()
        .toBuffer();
    const gif = await sharp(await Promise.all(['#f00', '#0f0', '#00f'].map(frame)), {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    const out = await processPhoto(gif);
    expect(out.inputFormat).toBe('gif');
    expect([out.width, out.height]).toEqual([30, 20]);
  });
});

describe('processPhoto — tamanho', () => {
  it('lado maior até 1600 px e nunca aumenta foto pequena', async () => {
    const big = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    const out = await processPhoto(big);
    expect([out.width, out.height]).toEqual([1600, 533]);
    const small = await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const o2 = await processPhoto(small);
    expect([o2.width, o2.height]).toEqual([100, 50]);
  });

  it('bomba de descompressão: pixels acima do teto dá photo_too_big sem decodificar', async () => {
    const img = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const e = await errorOf(processPhoto(img, { maxInputPixels: 1000 }));
    expect((e as PhotoRejected).code).toBe('photo_too_big');
  });

  it('passou do teto de bytes: tenta qualidade menor e depois lado menor; se nem assim, photo_too_big', async () => {
    const w = 300;
    const noise = Buffer.alloc(w * w * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const input = await sharp(noise, { raw: { width: w, height: w, channels: 3 } })
      .png()
      .toBuffer();
    const size = async (side: number, q: number) =>
      (
        await sharp(input)
          .resize(side, side, { fit: 'inside' })
          .jpeg({ quality: q, mozjpeg: true })
          .toBuffer()
      ).length;
    const s2 = await size(300, 72);
    const s3 = await size(150, 72);
    expect(s2).toBeGreaterThan(s3 + 1000); // pré-condição: o lado menor encolhe bem o ruído

    const out = await processPhoto(input, {
      maxSide: 300,
      fallbackSide: 150,
      maxOutputBytes: s3 + 500,
    });
    expect(out.width).toBe(150);
    expect(out.bytes).toBeLessThanOrEqual(s3 + 500);

    const e = await errorOf(
      processPhoto(input, { maxSide: 300, fallbackSide: 150, maxOutputBytes: 200 }),
    );
    expect((e as PhotoRejected).code).toBe('photo_too_big');
  });

  it('PNG transparente ganha o fundo escuro do app (não preto)', async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processPhoto(png);
    const { data } = await sharp(out.main).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [data[0], data[1], data[2]];
    // #12122A = (18, 18, 42), com folga do JPEG
    expect(Math.abs(r - 18)).toBeLessThan(6);
    expect(Math.abs(g - 18)).toBeLessThan(6);
    expect(Math.abs(b - 42)).toBeLessThan(6);
  });
});

describe('processPhoto — falha fechada', () => {
  it('sem sharp: PhotoProcessingUnavailable (o original cru nunca vai ao ar)', async () => {
    const e = await errorOf(processPhoto(Buffer.from('qualquer'), { loadSharp: () => null }));
    expect(e).toBeInstanceOf(PhotoProcessingUnavailable);
  });

  it('fila cheia (2 processando + 8 esperando): a 11ª dá PhotoBusy na hora', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (() => ({
      metadata: async () => {
        await gate;
        throw new Error('arquivo ruim');
      },
    })) as unknown as SharpFactory;
    const calls = Array.from({ length: 11 }, () =>
      processPhoto(Buffer.from('x'), { loadSharp: () => slow }).catch((e) => e),
    );
    expect(await calls[10]).toBeInstanceOf(PhotoBusy);
    release();
    for (const e of await Promise.all(calls.slice(0, 10))) expect(e).toBeInstanceOf(PhotoRejected);
    // a fila esvaziou: a próxima processa normalmente
    const ok = await processPhoto(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    );
    expect(ok.width).toBe(8);
  });
});

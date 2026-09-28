import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PhotoStatus } from '@cruzei/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { UPLOAD_DIR } from '../uploads/uploads.constants';
import { jpegForAnalysis } from '../uploads/thumbnails';
import { judgePhoto, photoModerationMode, type FaceAgeIn, type ModerationLabelIn, type PhotoVerdict } from './photo-rules';

export { photoModerationMode, type PhotoModerationMode } from './photo-rules';

const MAX_TRIES = 5;
const CONCURRENCY = 3;
const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024;

interface RekognitionModule {
  RekognitionClient: new (cfg: { region: string }) => { send: (cmd: unknown) => Promise<Record<string, unknown>> };
  DetectModerationLabelsCommand: new (input: unknown) => unknown;
  DetectFacesCommand: new (input: unknown) => unknown;
}

@Injectable()
export class PhotoModerationService {
  private readonly log = new Logger(PhotoModerationService.name);
  readonly mode = photoModerationMode();
  private readonly queue: string[] = [];
  private running = 0;
  private client: { send: (cmd: unknown) => Promise<Record<string, unknown>> } | null = null;
  private sdk: RekognitionModule | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
  ) {
    if (this.mode === 'off') this.log.warn('PHOTO_MODERATION=off: fotos novas vão ao ar sem análise (só pra desenvolvimento)');
    else this.log.log(`moderação de fotos: ${this.mode}`);
  }

  /** estado com que uma foto nova nasce */
  initialStatus(): PhotoStatus {
    return this.mode === 'off' ? 'approved' : 'pending';
  }

  /** manda uma foto recém-criada pra análise automática (no modo manual ela só espera a fila) */
  enqueue(photoId: string): void {
    if (this.mode !== 'rekognition') return;
    if (!this.queue.includes(photoId)) this.queue.push(photoId);
    this.pump();
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      this.analyze(id)
        .catch((e: Error) => this.log.warn(`análise da foto ${id} falhou: ${e.message}`))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  /** pendentes que a análise automática ainda não viu (processo reiniciou, AWS fora do ar): cron a cada 5 min */
  async sweep(): Promise<number> {
    if (this.mode !== 'rekognition') return 0;
    const rows = await this.prisma.photo.findMany({
      where: { status: 'pending', moderationLabels: { equals: null as never }, createdAt: { lt: new Date(Date.now() - 120_000) } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    rows.forEach((r) => this.enqueue(r.id));
    return rows.length;
  }

  async analyze(photoId: string): Promise<void> {
    const p = await this.prisma.photo.findUnique({ where: { id: photoId }, select: { id: true, userId: true, url: true, status: true } });
    if (!p || p.status !== 'pending') return;
    const tries = await this.redis.client.incr(`photo:mod:tries:${photoId}`);
    await this.redis.client.expire(`photo:mod:tries:${photoId}`, 86_400);
    if (tries > MAX_TRIES) {
      await this.decide(photoId, 'pending', { moderatorId: null, labels: ['análise automática falhou: revisar à mão'] });
      return;
    }
    const bytes = await this.bytesOf(p.url);
    if (!bytes) {
      await this.decide(photoId, 'pending', { moderatorId: null, labels: ['arquivo ilegível pra análise: revisar à mão'] });
      return;
    }
    const { labels, faces } = await this.detect(bytes);
    const v = judgePhoto(labels, faces);
    await this.applyVerdict(photoId, v);
  }

  private async applyVerdict(photoId: string, v: PhotoVerdict): Promise<void> {
    const status: PhotoStatus = v.decision === 'approve' ? 'approved' : v.decision === 'reject' ? 'rejected' : 'pending';
    await this.decide(photoId, status, { moderatorId: null, reason: v.reason, labels: v.labels.length ? v.labels : ['sem alertas'], urgent: v.urgent });
  }

  /**
   * Decisão sobre uma foto (automática ou de um moderador): grava, registra na trilha da moderação, derruba os caches
   * do perfil (a foto aparece/some do mapa e do cartão) e avisa o dono em tempo real.
   */
  async decide(
    photoId: string,
    status: PhotoStatus,
    opts: { moderatorId: string | null; reason?: string | null; labels?: string[]; urgent?: boolean },
  ): Promise<void> {
    const p = await this.prisma.photo.update({
      where: { id: photoId },
      data: {
        status,
        rejectReason: status === 'rejected' ? (opts.reason ?? 'Não segue as regras de fotos do Metch').slice(0, 100) : null,
        reviewedAt: status === 'pending' ? null : new Date(),
        reviewedBy: opts.moderatorId,
        ...(opts.labels ? { moderationLabels: { labels: opts.labels, urgent: Boolean(opts.urgent), reason: opts.reason ?? null } } : {}),
      },
      select: { userId: true },
    });
    const action = status === 'approved' ? 'photo_approve' : status === 'rejected' ? 'photo_reject' : 'photo_review';
    await this.prisma.moderationAction.create({
      data: { moderatorId: opts.moderatorId, targetUserId: p.userId, action, photoId, note: opts.reason ?? ((opts.labels ?? []).join('; ') || null) },
    });
    await this.redis.invalidateProfile(p.userId);
    if (status !== 'pending') {
      this.gateway.emitToUser(p.userId, 'photo_moderated', { photoId, status, reason: status === 'rejected' ? opts.reason ?? null : null });
    }
  }

  private async detect(bytes: Buffer): Promise<{ labels: ModerationLabelIn[]; faces: FaceAgeIn[] }> {
    if (!this.sdk) {
      // carregado só quando a análise automática está ligada (o SDK da AWS é pesado)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.sdk = require('@aws-sdk/client-rekognition') as RekognitionModule;
    }
    this.client ??= new this.sdk.RekognitionClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const [m, f] = await Promise.all([
      this.client.send(new this.sdk.DetectModerationLabelsCommand({ Image: { Bytes: bytes }, MinConfidence: 50 })),
      this.client.send(new this.sdk.DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['ALL'] })),
    ]);
    return { labels: (m.ModerationLabels as ModerationLabelIn[]) ?? [], faces: (f.FaceDetails as FaceAgeIn[]) ?? [] };
  }

  /** bytes JPEG da foto pra análise: arquivo local (/uploads) ou URL do CDN */
  private async bytesOf(url: string): Promise<Buffer | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    let input: string | Buffer;
    if (u.pathname.startsWith('/uploads/')) {
      input = path.join(UPLOAD_DIR, path.basename(u.pathname));
      if (!fs.existsSync(input)) return null;
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!res?.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return null;
      input = buf;
    }
    const jpeg = await jpegForAnalysis(input);
    if (jpeg) return jpeg.length <= REKOGNITION_MAX_BYTES ? jpeg : null;
    // sem sharp: só dá pra mandar JPEG/PNG pequeno do jeito que está
    const raw = typeof input === 'string' ? await fs.promises.readFile(input) : input;
    const isJpegOrPng = (raw[0] === 0xff && raw[1] === 0xd8) || (raw[0] === 0x89 && raw[1] === 0x50);
    return isJpegOrPng && raw.length <= REKOGNITION_MAX_BYTES ? raw : null;
  }
}

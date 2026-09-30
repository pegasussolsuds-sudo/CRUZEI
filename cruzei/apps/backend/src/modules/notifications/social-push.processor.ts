import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';

import { LIKES_FLUSH_JOB, SOCIAL_PUSH_QUEUE, type LikesFlushJob } from './social-push.queue';
import { SocialPushService } from './social-push.service';

/**
 * Executa os envios agendados do push social. Roda em todo processo do cluster: o Bull entrega cada job pra UM só
 * (trava do job), e o jobId por destinatário/janela impede job repetido.
 */
@Processor(SOCIAL_PUSH_QUEUE)
export class SocialPushProcessor {
  constructor(private readonly social: SocialPushService) {}

  @Process(LIKES_FLUSH_JOB)
  async flushLikes(job: Job<LikesFlushJob>): Promise<void> {
    await this.social.flushLikes(job.data);
  }
}

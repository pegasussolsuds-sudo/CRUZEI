import { SUPPORT_EVENTS, type SupportTypingEvent } from '@cruzei/shared-types';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import { ChatGateway } from '../../realtime/chat.gateway';
import { isUuid } from '../../realtime/conversation-access';
import { AccountStateService } from '../account/account-state.service';
import { isStaff } from '../admin/permissions';

import { SupportService } from './support.service';

/** a consulta de "qual atendimento" vale por um tempo curto no próprio socket (o "digitando" chega várias vezes/s) */
const LOOKUP_TTL_MS = 30_000;

/**
 * "Digitando" do suporte. Mesmo servidor socket.io do ChatGateway (mesma porta e namespace; a autenticação e as salas
 * user:<id>/staff:support são de lá). App: {isTyping} → a equipe vê o atendimento aberto da pessoa. Painel:
 * {threadId, isTyping} → a pessoa dona do atendimento (papel conferido de novo aqui, não só no connect).
 */
// CORS/Origin no SecureIoAdapter (mesmo servidor do ChatGateway)
@WebSocketGateway({ transports: ['websocket', 'polling'] })
export class SupportGateway {
  private readonly log = new Logger(SupportGateway.name);

  constructor(
    private readonly chat: ChatGateway,
    private readonly support: SupportService,
    private readonly accounts: AccountStateService,
  ) {}

  @SubscribeMessage(SUPPORT_EVENTS.typing)
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { isTyping?: unknown; threadId?: unknown },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const isTyping = Boolean(body?.isTyping);
    try {
      if (body?.threadId !== undefined) {
        if (!isUuid(body.threadId)) return;
        const st = await this.accounts.get(userId);
        if (!isStaff(st.role)) return;
        const owner = await this.cached(client, `own:${body.threadId}`, () =>
          this.support.threadOwner(body.threadId as string),
        );
        if (!owner) return;
        const ev: SupportTypingEvent = { threadId: body.threadId, author: 'staff', isTyping };
        this.chat.emitToUser(owner, SUPPORT_EVENTS.typing, ev);
        return;
      }
      const threadId = await this.cached(client, 'mine', () => this.support.openThreadIdOf(userId));
      if (!threadId) return;
      const ev: SupportTypingEvent = { threadId, author: 'user', isTyping };
      this.chat.emitToStaff(SUPPORT_EVENTS.typing, ev);
    } catch (e) {
      this.log.debug(`support:typing ignorado: ${(e as Error).message}`);
    }
  }

  /** cache por socket (some junto com ele) */
  private async cached(
    client: Socket,
    key: string,
    load: () => Promise<string | null>,
  ): Promise<string | null> {
    const data = client.data as { supportCache?: Map<string, { v: string | null; at: number }> };
    const m = (data.supportCache ??= new Map());
    const hit = m.get(key);
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.v;
    const v = await load();
    m.set(key, { v, at: Date.now() });
    if (m.size > 50) m.delete(m.keys().next().value as string);
    return v;
  }
}

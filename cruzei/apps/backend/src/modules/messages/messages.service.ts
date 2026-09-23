import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { v4 as uuid } from 'uuid';

type MessageRow = {
  id: string;
  matchId: string;
  senderId: string;
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
  mediaExpiresAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ChatGateway,
  ) {}

  // Retorna as últimas `limit` mensagens em ordem cronológica (antiga → nova)
  async list(matchId: string, userId: string, limit = 50, before?: Date) {
    await this.assertParticipant(matchId, userId);

    const rows = await this.prisma.message.findMany({
      where: {
        matchId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.reverse().map((m) => this.serialize(m));
  }

  async send(matchId: string, userId: string, content: string, clientId?: string) {
    const match = await this.assertParticipant(matchId, userId);
    if (match.status !== 'active') throw new BadRequestException('Match não está ativo');
    if (new Date() > match.chatExpiresAt) throw new BadRequestException('Chat expirado');
    if (!content || content.trim().length === 0) throw new BadRequestException('Mensagem vazia');
    if (content.length > 500) throw new BadRequestException('Mensagem muito longa (máx 500)');

    const message = await this.prisma.message.create({
      data: {
        id: uuid(),
        matchId,
        senderId: userId,
        content: content.trim(),
        messageType: 'text',
      },
    });

    this.broadcast(match, message, clientId);

    return {
      id: message.id,
      clientId,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async sendMedia(
    matchId: string,
    userId: string,
    type: 'photo_temp' | 'audio' | 'gif',
    mediaUrl: string,
    clientId?: string,
  ) {
    const match = await this.assertParticipant(matchId, userId);
    if (new Date() > match.chatExpiresAt) throw new BadRequestException('Chat expirado');

    const expiresAt = type === 'photo_temp' ? new Date(Date.now() + 10_000) : null;
    const message = await this.prisma.message.create({
      data: {
        id: uuid(),
        matchId,
        senderId: userId,
        messageType: type,
        mediaUrl,
        mediaExpiresAt: expiresAt,
      },
    });

    this.broadcast(match, message, clientId);

    return {
      id: message.id,
      clientId,
      mediaUrl: message.mediaUrl,
      mediaExpiresAt: message.mediaExpiresAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  async markRead(matchId: string, userId: string, messageIds: string[]) {
    const match = await this.assertParticipant(matchId, userId);
    if (messageIds.length === 0) return;
    const readAt = new Date();
    await this.prisma.message.updateMany({
      where: {
        id: { in: messageIds },
        matchId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt },
    });
    const other = match.userAId === userId ? match.userBId : match.userAId;
    this.gateway.emitToUser(other, 'message_read', { matchId, messageIds, readAt: readAt.toISOString() });
  }

  private broadcast(match: { id: string; userAId: string; userBId: string }, message: MessageRow, clientId?: string) {
    const payload = { matchId: match.id, message: { ...this.serialize(message), clientId } };
    this.gateway.emitToUsers([match.userAId, match.userBId], 'message_received', payload);
  }

  private serialize(m: MessageRow) {
    return {
      id: m.id,
      matchId: m.matchId,
      senderId: m.senderId,
      type: m.messageType,
      content: m.content,
      mediaUrl: m.mediaUrl,
      mediaExpiresAt: m.mediaExpiresAt?.toISOString() ?? null,
      readAt: m.readAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async assertParticipant(matchId: string, userId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match não encontrado');
    if (match.userAId !== userId && match.userBId !== userId) {
      throw new ForbiddenException('Sem acesso a este match');
    }
    return match;
  }
}

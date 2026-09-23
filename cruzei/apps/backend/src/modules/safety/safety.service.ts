import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  // Submete selfie pra verificação por humanos/AI. Stub — fila + verificação fora do escopo.
  async submitVerification(userId: string, selfieUrl: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { verificationSelfieUrl: selfieUrl } as never,
    });
  }
}

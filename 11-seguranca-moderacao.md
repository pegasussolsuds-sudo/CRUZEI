# 11 — Segurança e Moderação

> LGPD, verificação, denúncias, ban, anti-stalker.
> Cruzei só funciona se for seguro pra todo mundo.

---

## 🎯 Filosofia

Mulheres são o gargalo de dating apps. Se não for seguro, não cresce.

Princípios:
1. **Mulheres têm prioridade** — botões extras, verificação, suporte
2. **Modo anônimo default** — quem quer aparecer se expõe conscientemente
3. **Verificação visível** — badge azul pra quem fez selfie
4. **Denúncia fácil** — um toque, ação rápida
5. **Ban agressivo** — perfil fake, assédio, stalking = ban permanente

---

## 📜 LGPD — Conformidade

### Base legal
- **Execução de contrato** — usuário aceita termos ao se cadastrar
- **Consentimento específico** — localização, fotos, notificações
- **Legítimo interesse** — segurança (prevenção de fraude)

### Direitos do usuário (Art. 18 LGPD)

| Direito | Endpoint | Implementação |
|---------|----------|---------------|
| Confirmação de existência | GET /me/exists | Já implementado |
| Acesso aos dados | GET /me/export | Retorna JSON com tudo |
| Correção | PATCH /me | Atualiza perfil |
| Anonimização | DELETE /me/data | Anonimiza dados não essenciais |
| Eliminação | DELETE /auth/account | Soft delete → hard delete 30 dias |
| Portabilidade | GET /me/export | JSON estruturado |
| Revogação | DELETE /auth/account | Mesmo que eliminação |

### Política de retenção

```
Dados pessoais:
  - Conta ativa: enquanto usuário quiser
  - Conta deletada (30 dias grace): recuperável
  - Após 30 dias: hard delete + audit log
  
Localização:
  - Redis: 5h (TTL)
  - Postgres: 30 dias (limpeza automática)
  - Anônimo agregado por bairro: indefinido
  
Mensagens:
  - Match ativo: enquanto match existir
  - Match expirado: 30 dias
  - Após 30 dias: hard delete
  
Logs:
  - Auditoria: 1 ano
  - Debug: 30 dias
```

### Termos de Uso (resumo dos pontos críticos)

```
1. Você é responsável pelo conteúdo que posta
2. Não pode assediar, ameaçar ou intimidar outros usuários
3. Não pode usar fotos de terceiros sem autorização
4. Não pode criar perfis falsos
5. Não pode usar o app pra fins comerciais não autorizados
6. Podemos banir sem aviso prévio em casos graves
7. Localização é armazenada por 30 dias (LGPD)
8. Você pode deletar sua conta a qualquer momento
9. Chat expira em 48h por design
10. Modo anônimo é por padrão na primeira instalação
```

---

## ✅ Verificação de Identidade

### 3 níveis

```
Nível 0: Sem verificação
  - Qualquer pessoa pode criar conta
  - Sem badge
  
Nível 1: Verificação por SMS (automática)
  - Telefone confirmado
  - Sem foto de perfil (não confiável)
  
Nível 2: Verificação por Selfie (badge azul)
  - Selfie em tempo real
  - Comparação com foto do perfil via ML
  - Badge azul visível no app
```

### Fluxo de verificação (Nível 2)

```
1. User toca em "Verificar perfil"
2. Tutorial (3 telas)
   - "Selfie segura"
   - "Sem óculos/chapéu"
   - "Boa iluminação"
3. Câmera frontal abre
4. 5 fotos são capturadas (detecção de vivacidade)
5. Enviadas pro backend
6. Backend compara com foto principal via AWS Rekognition
7. Score de similaridade
   - > 90% = verificado ✓
   - 70-90% = revisão manual
   - < 70% = rejeitado
8. Notificação do resultado
9. Badge aparece no perfil
```

### Implementação AWS Rekognition

```typescript
// src/modules/verification/verification.service.ts
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';

class VerificationService {
  async verifySelfie(userId: string, selfieUrl: string, profilePhotoUrl: string) {
    const client = new RekognitionClient({ region: 'us-east-1' });

    const command = new CompareFacesCommand({
      SourceImage: { S3Object: { Name: this.s3KeyForUrl(selfieUrl) } },
      TargetImage: { S3Object: { Name: this.s3KeyForUrl(profilePhotoUrl) } },
      SimilarityThreshold: 70,
    });

    const response = await client.send(command);
    const match = response.FaceMatches?.[0];
    
    if (!match) {
      return { verified: false, reason: 'no_match' };
    }

    const similarity = match.Similarity || 0;

    if (similarity >= 90) {
      await db.users.update({
        where: { id: userId },
        data: {
          is_verified: true,
          verified_at: new Date(),
          verification_selfie_url: selfieUrl,
        },
      });
      return { verified: true, similarity };
    }

    if (similarity >= 70) {
      // Revisão manual
      await db.verifications.create({
        data: {
          user_id: userId,
          selfie_url: selfieUrl,
          profile_photo_url: profilePhotoUrl,
          similarity,
          status: 'manual_review',
        },
      });
      return { verified: false, reason: 'manual_review' };
    }

    return { verified: false, reason: 'low_similarity' };
  }
}
```

### Anti-Spoof (Vivacidade)

```typescript
// Detecção de que é uma pessoa real e não foto/vídeo
async detectLiveness(images: string[]): Promise<boolean> {
  // 5 fotos com instruções diferentes
  // 1. Olhe pra frente
  // 2. Sorria
  // 3. Vire a cabeça à esquerda
  // 4. Vire a cabeça à direita
  // 5. Pisque

  // ML verifica se cada pose é consistente com uma face 3D
  // (não pode ser uma foto planar)
  
  const livenessChecks = await Promise.all(
    images.map((img, i) => this.checkPose(img, expectedPose[i]))
  );
  
  return livenessChecks.every(check => check.score > 0.8);
}
```

---

## 🚫 Sistema de Denúncias

### Como reportar

**Em qualquer perfil:**
```
Botão "..." → "Denunciar"
  ↓
Modal com motivos:
  - Assédio
  - Perfil falso
  - Spam
  - Conteúdo inapropriado (foto)
  - Comportamento suspeito
  - Outro (campo livre)
  ↓
Opcional: anexar prints (até 3)
  ↓
Confirmação: "Denúncia enviada. Vamos analisar."
```

### Backend de moderação

```typescript
// src/modules/reports/reports.service.ts
class ReportsService {
  async createReport(data: ReportData) {
    // 1. Salva denúncia
    const report = await db.reports.create({ data });

    // 2. Avaliação automática (ML)
    const riskScore = await this.evaluateRisk(data.reported_id);

    // 3. Decisão
    if (riskScore > 0.9) {
      // Ban automático (perfil com 3+ denúncias graves)
      await this.autoBan(data.reported_id, 'multiple_reports');
      await this.notifyReporter(data.reporter_id, 'action_taken');
    } else if (riskScore > 0.5) {
      // Revisão manual em 24h
      await this.queueForReview(report.id);
    } else {
      // Baixa prioridade, batch review em 7 dias
    }

    return report;
  }

  private async evaluateRisk(userId: string): Promise<number> {
    const user = await db.users.findUnique({
      where: { id: userId },
      include: {
        reports_received: { where: { status: 'pending' } },
        is_verified: true,
        created_at: true,
      },
    });

    let score = 0;

    // 5+ denúncias = score alto
    if (user.reports_received.length >= 5) score += 0.5;
    if (user.reports_received.length >= 10) score += 0.8;

    // Sem verificação = +20% (anonimato)
    if (!user.is_verified) score += 0.2;

    // Conta nova (< 7 dias) = +30%
    const ageInDays = differenceInDays(new Date(), user.created_at);
    if (ageInDays < 7) score += 0.3;

    // Padrões de spam (muitos likes em pouco tempo)
    const recentLikes = await db.likes.count({
      where: {
        liker_id: userId,
        created_at: { gt: subDays(new Date(), 1) },
      },
    });
    if (recentLikes > 100) score += 0.4;

    return Math.min(score, 1);
  }
}
```

### Painel admin (futuro)

```
┌─────────────────────────────────────────┐
│  📋 Fila de moderação (47 pendentes)    │
├─────────────────────────────────────────┤
│  🚨 ALTA (12)                           │
│  🟡 MÉDIA (20)                          │
│  🟢 BAIXA (15)                          │
│                                         │
│  Por motivo:                            │
│  - Assédio: 23                          │
│  - Falso: 12                            │
│  - Spam: 8                              │
│  - Inapropriado: 4                      │
└─────────────────────────────────────────┘
```

---

## 🔒 Anti-Stalker

### Proteções implementadas

| Proteção | Implementação |
|----------|---------------|
| Distância aproximada | Free vê "perto" em vez de "120m" |
| Match mútuo obrigatório | Não dá pra mandar mensagem sem match |
| Sem lista de quem visitou | Só Premium+ vê (com filtro de tempo) |
| Pausar app | Some do mapa por X tempo |
| Bloquear fácil | 2 toques, sem justificativa |
| Histórico de presença | 5h só, depois some |
| Notificação de visita | User pode desativar (Premium+) |
| Report de comportamento suspeito | Categoria dedicada |

### Algoritmo de detecção

```typescript
// src/modules/safety/stalker-detection.service.ts
class StalkerDetectionService {
  // Roda diariamente
  async detectSuspiciousPatterns(userId: string) {
    const user = await db.users.findUnique({ where: { id: userId } });

    // 1. Verifica se alguém aparece em todo lugar que esse user vai
    const suspiciousFollowers = await db.$queryRaw`
      WITH user_pois AS (
        SELECT DISTINCT poi_id, recorded_at::date as day
        FROM locations
        WHERE user_id = ${userId}
          AND recorded_at > NOW() - INTERVAL '7 days'
      ),
      potential_stalkers AS (
        SELECT 
          l.user_id,
          COUNT(DISTINCT l.poi_id) as shared_pois,
          COUNT(DISTINCT l.recorded_at::date) as shared_days
        FROM locations l
        JOIN user_pois up ON up.poi_id = l.poi_id 
                           AND up.day = l.recorded_at::date
        WHERE l.user_id != ${userId}
          AND l.recorded_at > NOW() - INTERVAL '7 days'
        GROUP BY l.user_id
        HAVING COUNT(DISTINCT l.poi_id) >= 5
      )
      SELECT * FROM potential_stalkers
      WHERE shared_days >= 3
    `;

    for (const stalker of suspiciousFollowers) {
      // 2. Se stalker visitou perfil muitas vezes
      const visits = await db.visits.count({
        where: {
          visitor_id: stalker.user_id,
          visited_id: userId,
          visited_at: { gt: subDays(new Date(), 7) },
        },
      });

      if (visits > 10) {
        // 3. Notifica user sobre comportamento suspeito
        await this.notifyPotentialVictim(userId, stalker.user_id);
        // 4. Marca perfil do stalker pra revisão
        await db.users.update({
          where: { id: stalker.user_id },
          data: { _flag_stalker_review: true },
        });
      }
    }
  }

  private async notifyPotentialVictim(userId: string, stalkerId: string) {
    await this.fcm.send(userId, {
      type: 'safety_alert',
      title: 'Comportamento suspeito detectado',
      body: 'Alguém apareceu em vários lugares próximos a você. Considere bloquear.',
      data: {
        action: 'open_safety_tips',
        reported_user_id: stalkerId,
      },
    });
  }
}
```

---

## 🚨 Botão de Pânico

### Para mulheres em situação de risco

```
┌─────────────────────────────────────────┐
│  🆘 EMERGÊNCIA                         │
│                                         │
│  Se você está em perigo imediato,       │
│  ligue 190 (Polícia) ou 180            │
│  (Central da Mulher).                   │
│                                         │
│  [📞 Ligar 190]                        │
│  [📞 Ligar 180]                        │
│  [🚪 Sair do app]                      │
│                                         │
│  O Cruzei pode:                         │
│  - Pausar seu perfil por 7 dias        │
│  - Bloquear automaticamente quem       │
│    você denunciar                       │
│  - Reportar local à polícia (LGPD)     │
│  - Notificar seus matches              │
│                                         │
│  [🚨 Acionar proteção]                │
└─────────────────────────────────────────┘
```

### Implementação

```typescript
// src/modules/safety/panic.service.ts
class PanicService {
  async activatePanic(userId: string, reason: string) {
    // 1. Pausa conta por 7 dias
    await db.users.update({
      where: { id: userId },
      data: {
        is_paused: true,
        paused_until: addDays(new Date(), 7),
      },
    });

    // 2. Log anônimo pra nossa equipe (sem LGPD violation)
    await db.audit_log.create({
      data: {
        user_id: userId,
        action: 'panic_activated',
        metadata: { reason },
      },
    });

    // 3. Oferece suporte humano (chat com moderador)
    // 4. Lista de contatos de emergência
  }
}
```

---

## 🛡️ Moderação de Conteúdo

### Fotos

```typescript
// Upload de foto passa por moderação
class PhotoModerationService {
  async moderate(userId: string, photoUrl: string): Promise<ModerationResult> {
    // 1. Detecção de nudez (AWS Rekognition)
    const moderation = await this.rekognition.detectModerationLabels({
      Image: { S3Object: { Name: this.s3Key(photoUrl) } },
    });

    const labels = moderation.ModerationLabels || [];

    const hasNudity = labels.some(l => 
      ['Explicit Nudity', 'Sexual Activity', 'Graphic Violence'].includes(l.Name)
    );

    if (hasNudity) {
      // Rejeita automaticamente
      await db.photos.update({
        where: { url: photoUrl },
        data: { status: 'rejected', reason: 'nudity' },
      });
      return { approved: false, reason: 'nudity' };
    }

    // 2. Detecção de menor de idade (via estimativa)
    const faceDetection = await this.rekognition.detectFaces({
      Image: { S3Object: { Name: this.s3Key(photoUrl) } },
    });

    const estimatedAge = faceDetection.FaceDetails?.[0]?.AgeRange;

    if (estimatedAge && (estimatedAge.Low < 18 || estimatedAge.High > 70)) {
      // Revisão manual
      await this.flagForReview(photoUrl, 'age_estimate_suspicious');
      return { approved: false, reason: 'manual_review' };
    }

    return { approved: true };
  }
}
```

### Mensagens

```typescript
// Mensagens passam por filtro de palavras proibidas
class MessageModerationService {
  private bannedWords = [
    // PT-BR
    'puta', 'vagabunda', 'piranha', 'cachorra',
    'bicha', 'viado', 'sapatão',
    // Contatos (telefone, email, instagram)
    /\b\d{4,}\b/,  // sequência de números
    /@\w+\.\w+/,  // email
  ];

  async moderate(content: string): Promise<ModerationResult> {
    // 1. Filtro de palavras
    if (this.bannedWords.some(w => 
      typeof w === 'string' 
        ? content.toLowerCase().includes(w)
        : w.test(content)
    )) {
      return { approved: false, reason: 'banned_words' };
    }

    // 2. Detecção de contato externo
    if (this.containsContactInfo(content)) {
      return { approved: false, reason: 'external_contact' };
    }

    return { approved: true };
  }
}
```

---

## 📊 Métricas de Segurança

### KPIs

| Métrica | Meta | Como medir |
|---------|------|------------|
| Taxa de denúncia | < 0.5% dos matches | reports / matches |
| Tempo de resposta | < 24h | reports.created → reports.resolved |
| Taxa de ban | < 0.2% dos usuários | bans / MAU |
| Verificados | > 30% do MAU | verified / MAU |
| Falsos positivos de moderação | < 5% | appeals / banned |
| Recall de assédio | > 95% | reports confirmados / reports totais |

### Dashboard

```
┌─────────────────────────────────────────┐
│  🛡️ SEGURANÇA — Últimos 30 dias        │
├─────────────────────────────────────────┤
│  Denúncias: 47 (0.3% dos matches)       │
│  Tempo médio de resposta: 8h            │
│  Bans: 12 (0.08% do MAU)               │
│  Verificados: 34% do MAU              │
│  Falsos positivos: 3%                  │
│  Recall de assédio: 96%                │
└─────────────────────────────────────────┘
```

---

## 🚪 Bloqueio

### UX simples

```
Perfil de "Lucas"
  ↓
Botão "..." (canto superior)
  ↓
"🚫 Bloquear Lucas"
  ↓
Confirmação:
  "Lucas não vai mais:
   - Aparecer no seu mapa
   - Ver seu perfil
   - Mandar mensagem"
  ↓
[Ação tomada. Lucas não vai mais interagir com você.]
```

### Backend

```typescript
// src/modules/blocks/blocks.service.ts
class BlocksService {
  async block(blockerId: string, blockedId: string, reason?: string) {
    // 1. Cria block
    await db.blocks.create({
      data: { blocker_id: blockerId, blocked_id: blockedId, reason },
    });

    // 2. Se tinha match, finaliza
    const match = await db.matches.findFirst({
      where: {
        OR: [
          { user_a_id: blockerId, user_b_id: blockedId },
          { user_a_id: blockedId, user_b_id: blockerId },
        ],
        status: 'active',
      },
    });

    if (match) {
      await db.matches.update({
        where: { id: match.id },
        data: { status: 'blocked' },
      });
      // WebSocket: notifica ambos os lados
    }

    // 3. Remove likes pendentes
    await db.likes.deleteMany({
      where: {
        OR: [
          { liker_id: blockerId, liked_id: blockedId },
          { liker_id: blockedId, liked_id: blockerId },
        ],
      },
    });

    // 4. Limpa do Redis
    await this.removeFromPresence(blockerId, blockedId);
    await this.removeFromPresence(blockedId, blockerId);
  }
}
```

---

## 🔐 Criptografia e Segurança Técnica

### Dados em trânsito
- TLS 1.3 obrigatório
- HSTS habilitado
- Certificate pinning no mobile (em produção)

### Dados em repouso
- DB encryption at-rest (RDS)
- Backup encryption (S3)
- Photos criptografadas no R2

### Autenticação
- JWT com refresh
- Tokens de curta duração (15min)
- Blacklist de tokens revogados

### Senhas (se login email)
- bcrypt com cost 12
- Salt único por usuário
- Política: 8+ chars, 1 número, 1 maiúscula

### API Security
- Rate limiting agressivo
- Helmet (headers de segurança)
- CORS restrito
- Input validation em 100% dos endpoints
- SQL injection prevention (Prisma)
- XSS prevention (sanitização)

---

## 👥 Equipe de Moderação

### Estrutura (mês 6+)

```
1 Moderador líder
  ├── 2 Moderadores (turnos)
  ├── ML/AI Engineer (automações)
  └── Legal/LGPD advisor (consultivo)
```

### Treinamento

- LGPD
- Detecção de assédio
- Contexto cultural brasileiro
- Tom de voz Cruzei
- Casos de stalking

### SLA

| Prioridade | SLA | Ação |
|-----------|-----|------|
| 🚨 Urgente (ameaça) | 1h | Ban + contato |
| 🔴 Alta (assédio) | 8h | Ban + notificar |
| 🟡 Média (spam) | 24h | Ban ou warning |
| 🟢 Baixa (outros) | 7 dias | Revisão batch |

---

## 📋 Política de Ban

### Ban permanente (imediato)
- Assédio sexual comprovado
- Stalking
- Menor de idade descoberto
- Golpe financeiro
- Fake profile + assédio

### Ban temporário (7/30 dias)
- Spam (primeira vez)
- Conteúdo inapropriado (segunda vez)
- Desrespeito após warning

### Warning
- Linguagem ofensiva (primeira vez)
- Foto borderline
- Bio inadequada

### Processo de appeal

```
1. User recebe email de ban
2. Email inclui link pra appeal
3. User explica por que deve voltar
4. Moderador analisa (24h SLA)
5. Decisão final (mantém ou revoga)
```

---

## 🤝 Compliance com App Stores

### Apple App Store
- Privacy labels atualizados
- Sign in with Apple (oferecer)
- IAP obrigatório (já cumprido)
- Guideline 1.1 (safety): botão pânico, verificação
- Guideline 5.1 (privacy): LGPD/GDPR compliance

### Google Play
- Data safety form preenchido
- Permissions declaradas corretamente
- Target API 34+
- Family policy compliance (idade)

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [12-monetizacao.md](./12-monetizacao.md)
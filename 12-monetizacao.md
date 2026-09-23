# 12 — Monetização

> Free, Premium, Premium+, Boost.
> Como o Cruzei ganha dinheiro sem perder usuários.

---

## 💰 Modelo de Negócio

Cruzei é um **freemium dating app** com receita principal via **assinaturas recorrentes**, complementado por **compras in-app** (boosts, super curtidas) e **receita B2B futura** (parcerias com locais).

---

## 📦 Tiers de Assinatura

### 🥉 Free — R$ 0

**O que tem:**
- ✅ Cadastro e perfil básico
- ✅ Ver mapa de pessoas próximas (últimas 5h)
- ✅ Enviar mensagem pra quem está/esteve no local (5h)
- ✅ 1 super curtida por dia
- ✅ Curtir e passar (sem limite)
- ✅ Chat com expiração de 48h
- ✅ Modo anônimo

**O que não tem:**
- ❌ Avatar com destaque no mapa
- ❌ Ver cidade inteira (só raio configurável)
- ❌ Voltar perfil
- ❌ Mensagem pra quem não está no local
- ❌ Ver quem te curtiu
- ❌ Filtros avançados
- ❌ Múltiplas super curtidas

### 🥈 Premium — R$ 29,90/mês

**Tudo do Free, mais:**
- ✅ 9 super curtidas por dia
- ✅ Voltar perfil (5 por dia)
- ✅ Ver pessoas da cidade inteira (sem restrição de local)
- ✅ 3 mensagens por dia pra quem não está no local
- ✅ Filtros avançados (idade, distância, presença)
- ✅ Sem anúncios
- ✅ Ver últimas 5 curtidas recebidas

### 🥇 Premium+ — R$ 49,90/mês

**Tudo do Premium, mais:**
- ✅ Avatar com destaque no mapa (Premium+)
- ✅ Ver TODAS as curtidas recebidas
- ✅ Boost de revelação incluído (1/mês grátis)
- ✅ Anônimo ilimitado (Free = 24h contínuas)
- ✅ Selos premium exclusivos
- ✅ Ver quem visitou seu perfil (anônimo + visível)

---

## 💵 Tabela Comparativa Completa

| Recurso | Free | Premium | Premium+ |
|---------|:----:|:-------:|:--------:|
| Ver pessoas no local (5h) | ✅ | ✅ | ✅ |
| Chat (expira 48h) | ✅ | ✅ | ✅ |
| Curtir | ✅ | ✅ | ✅ |
| Super curtida | 1/dia | 9/dia | 9/dia |
| Voltar perfil | ❌ | 5/dia | 5/dia |
| Ver cidade inteira | ❌ | ✅ | ✅ |
| Mensagem sem estar no local | ❌ | 3/dia | 10/dia |
| Modo anônimo | ✅ | ✅ | ✅ |
| Avatar com destaque | ❌ | ❌ | ✅ |
| Ver quem te curtiu | ❌ | Últimas 5 | Todas |
| Boost de revelação | ❌ | ❌ | 1/mês grátis |
| Filtros avançados | ❌ | ✅ | ✅ |
| Sem anúncios | ❌ | ✅ | ✅ |
| Selos premium | ❌ | ❌ | ✅ |
| Anônimo ilimitado | ❌ | ❌ | ✅ |

---

## 🛒 Compras In-App

### Boost de Revelação — R$ 4,90

**O que faz:**
- Seu avatar fica maior e com brilho no mapa
- Aparece no topo do mapa por 1 hora
- Visível pra até 5km de raio
- Notificação push pra usuários próximos

**Quando comprar:**
- Dia que você quer conhecer gente
- Quando tá em local movimentado
- Fim de semana
- Show, evento, festa

**Limite:** 1 boost por hora ativa

### Pacote de Super Curtidas — R$ 9,90

**O que vem:** 30 super curtidas

**Quando comprar:**
- Acabaram suas 9 diárias
- Quer dar em várias pessoas específicas
- Quer maximizar chances no dia

### Selo Exclusivo Premium+ — R$ 1,90 cada

**Tipos:**
- 👑 Fundador (primeiros 1000 usuários)
- 🌟 VIP
- 🎉 Beta Tester
- 💎 Influencer

**Benefício:** destaque no perfil, badge raro

### Anônimo Ilimitado (add-on Free) — R$ 4,90/mês

Para usuários Free que querem anônimo sem limite de 24h.

### Premium Anual — R$ 199,90 (44% off)

Para usuários comprometidos com o app.

---

## 💳 Implementação de Pagamento

### Plataformas

| Plataforma | Provider | Por quê |
|-----------|----------|---------|
| **iOS** | Apple In-App Purchase (IAP) | Obrigatório pela Apple |
| **Android** | Google Play Billing | Obrigatório pela Google |
| **Web (futuro)** | Stripe Checkout | Mais flexível |

### Fluxo (iOS)

```
1. User toca em "Assinar Premium"
2. App mostra produtos via StoreKit 2
3. User confirma compra (Face ID / Touch ID)
4. Apple processa pagamento
5. App recebe receipt
6. App envia receipt pro backend: POST /premium/subscribe
7. Backend valida via App Store Server API
8. Backend ativa premium
9. User recebe confirmação
```

### Validação Server-Side (CRÍTICO)

```typescript
// src/modules/subscriptions/apple-iap.service.ts
import { AppStoreServerAPI } from 'app-store-server-api';

class AppleIAPService {
  async verifyReceipt(receipt: string, userId: string): Promise<Subscription> {
    const client = new AppStoreServerAPI(
      process.env.APPSTORE_ISSUER_ID,
      process.env.APPSTORE_KEY_ID,
      process.env.APPSTORE_PRIVATE_KEY
    );

    // 1. Verifica receipt com Apple
    const transaction = await client.verifyTransaction(receipt);

    if (!transaction || transaction.bundleId !== 'com.cruzei.app') {
      throw new Error('Invalid receipt');
    }

    // 2. Determina tier baseado no product_id
    const tier = this.tierFromProductId(transaction.productId);

    // 3. Salva assinatura
    const subscription = await db.subscriptions.upsert({
      where: { original_transaction_id: transaction.originalTransactionId },
      create: {
        user_id: userId,
        tier,
        platform: 'ios',
        original_transaction_id: transaction.originalTransactionId,
        product_id: transaction.productId,
        starts_at: new Date(transaction.purchaseDate),
        expires_at: new Date(transaction.expiresDate),
      },
      update: {
        expires_at: new Date(transaction.expiresDate),
        cancelled_at: transaction.revocationDate 
          ? new Date(transaction.revocationDate) 
          : null,
      },
    });

    // 4. Atualiza user
    await db.users.update({
      where: { id: userId },
      data: {
        premium_tier: tier,
        premium_expires_at: subscription.expires_at,
      },
    });

    return subscription;
  }

  private tierFromProductId(productId: string): PremiumTier {
    if (productId.includes('premium_plus')) return 'premium_plus';
    if (productId.includes('premium_yearly')) return 'premium';
    return 'premium';
  }
}
```

### Webhook de Renovação/Cancelamento

```typescript
// POST /webhooks/apple
// POST /webhooks/google
// POST /webhooks/stripe

async handleAppStoreWebhook(event: AppStoreEvent) {
  switch (event.notificationType) {
    case 'DID_RENEW':
      await this.activateSubscription(event);
      break;
    case 'DID_FAIL_TO_RENEW':
      await this.notifyUserOfPaymentFailure(event);
      break;
    case 'CANCELLED':
      await this.markCancelled(event);
      break;
    case 'REFUND':
      await this.handleRefund(event);
      break;
  }
}
```

---

## 📊 Projeção de Receita

### Cenário Conservador (mês 12)

| Métrica | Valor |
|---------|-------|
| MAU | 250.000 |
| Conversão Free → Premium | 3% |
| Usuários Premium | 7.500 |
| Usuários Premium+ (1% do total) | 2.500 |
| **MRR Premium** (7.500 × R$ 29,90) | **R$ 224.250** |
| **MRR Premium+** (2.500 × R$ 49,90) | **R$ 124.750** |
| **MRR Assinaturas** | **R$ 349.000** |
| **MRR Boost** (R$ 50k × 1/mês × R$ 4,90) | **R$ 245.000** |
| **MRR Total** | **~R$ 600.000/mês** |
| **ARR** | **~R$ 7.200.000/ano** |

### Cenário Otimista (mês 12)

| Métrica | Valor |
|---------|-------|
| MAU | 500.000 |
| Conversão | 5% |
| Usuários Premium | 20.000 |
| Usuários Premium+ | 5.000 |
| **MRR Total** | **~R$ 1.500.000/mês** |
| **ARR** | **~R$ 18M/ano** |

### Payback

- **Custo até mês 12:** ~R$ 1.5M
- **Receita mês 12:** R$ 600k (conservador)
- **Break-even:** mês 10-12

---

## 📈 Estratégia de Conversão Free → Premium

### Gatilhos no app

```
1. Tentou ver cidade inteira → "💎 Premium mostra cidade toda"
2. Tentou voltar perfil → "↩️ Premium pode voltar"
3. Tentou mensagem sem match local → "📨 Premium pode chegar em qualquer pessoa"
4. Acabaram 1 super curtida → "⭐ 9 super curtidas com Premium"
5. Viu 6+ curtidas → "👀 Veja quem te curtiu com Premium+"
6. Atingiu R$ 100 likes/mês → "💎 Tá ativa. Bora Premium?"
7. Anônimo > 24h → "🕶️ Anônimo ilimitado com Premium+"
```

### Telas de paywall

#### Paywall 1 (ao tentar recurso bloqueado)
```
┌─────────────────────────────────────────┐
│  💎 Cruzei Premium                      │
│  ─────────────────────────────          │
│                                         │
│  👀 Vê quem te curtiu                   │
│  ↩️ Volta perfil pra reconsiderar       │
│  🌍 Vê cidade inteira                  │
│  ⭐ 9 super curtidas/dia               │
│  📨 Manda mensagem sem estar no local  │
│                                         │
│  R$ 29,90/mês  ou  R$ 199,90/ano       │
│  7 dias grátis pra experimentar        │
│                                         │
│  [🚀 Experimentar grátis]              │
│  [Restaurar compra]                    │
└─────────────────────────────────────────┘
```

#### Paywall 2 (após match gratuito)
```
┌─────────────────────────────────────────┐
│  🎉 Match garantido!                    │
│                                         │
│  Continue curtindo sem limites com     │
│  Cruzei Premium.                        │
│                                         │
│  ✅ 9 super curtidas/dia               │
│  ✅ Voltar perfil (5/dia)              │
│  ✅ Filtros avançados                  │
│                                         │
│  [💎 Virar Premium por R$ 29,90]       │
│  [Continuar com Free]                  │
└─────────────────────────────────────────┘
```

### A/B Testing de preços

```
Teste 1: R$ 19,90 vs R$ 29,90 vs R$ 39,90
  → Esperado: R$ 29,90 maximiza LTV

Teste 2: Mensal vs Trimestral vs Anual
  → Mostrar anual primeiro (LTV maior)

Teste 3: Com trial vs sem trial
  → Com 7 dias trial: +15% conversão inicial
  → Sem trial: -30% churn
```

### Push notification pra conversão

```
"💎 12 pessoas curtiram você nas últimas 24h.
   Desbloqueie pra ver com Premium.

   [Ver planos]"
```

---

## 💸 Receita B2B (Mês 6+)

### Locais Patrocinados

**O quê:** Bar, restaurante, evento paga pra ter destaque no mapa.

**Modelo de preço:**
- Hotspot fixo no mapa: R$ 199/mês
- Hotspot pulsante animado: R$ 499/mês
- Patrocinado por evento: R$ 1.500/evento

**O que ganha:**
- Pin destacado com cor diferenciada
- Lista de pessoas no local em destaque
- Notificação push pra usuários próximos
- Oferta exclusiva no perfil do local

**Projeção:** 50 locais × R$ 300 médio = **R$ 15k/mês** em 12 meses

### API de Presença (anonimizada)

**Para:** prefeituras, marcas, pesquisas de mercado.

**O quê:** dados anônimos de densidade de pessoas em locais.

**Exemplo:** "Zona Sul de SP tem 3x mais usuários entre 22h-2h"

**Modelo de preço:**
- Relatório mensal: R$ 5.000
- API em tempo real: R$ 20.000/mês
- Pesquisa custom: R$ 30.000+

**Projeção:** 5 clientes × R$ 10k = **R$ 50k/mês** em 18 meses

### Eventos Parceiros

**O quê:** Festivais, shows, eventos grandes.

**Modelo:** R$ 5.000-50.000 por evento (dependendo do porte).

**Benefício pro evento:**
- Geofence com avatar do Cruzei
- Notificação pra usuários na região
- Match boost em participantes
- Hotspot exclusivo

**Projeção:** 10 eventos/ano × R$ 15k = **R$ 150k/ano**

---

## 🎯 Funil de Receita

```
100 installs
   ↓
80 ativam (completam onboarding)
   ↓
40 usam por 30 dias
   ↓
20 dão like em alguém
   ↓
5 têm match
   ↓
3 conversam (mensagens)
   ↓
1 vira Premium (R$ 29,90)
   ↓
0.1 compra Boost (R$ 4,90)

LTV médio por usuário: R$ 45-60 (12 meses)
```

---

## 📊 KPIs de Receita

| KPI | Meta | Como medir |
|-----|------|------------|
| ARPU (Average Revenue Per User) | R$ 8/mês no mês 6 | MRR / MAU |
| Conversão Free → Premium | 3-5% | new_subs / MAU |
| Churn mensal | < 8% | cancelamentos / MAU |
| LTV | > R$ 90 | ARPU × avg_lifetime |
| LTV/CAC | > 3 | ratio |
| Trial → Conversion | 60% | trials_converted / trials_started |
| Boost por usuário | 0.5/mês | boosts / MAU |

---

## 🚫 Anti-Churn

### Quando detectar risco de churn

```
- Não abriu app há 7+ dias
- Não deu like há 14+ dias
- Não tem match há 21+ dias
- Premium renovando em 3 dias
```

### Ações

```
1. Push com notificação contextual
   "47 pessoas no Bar do Léo agora"
   "Mariana curtiu você ontem"

2. Email com resumo
   "Você tem 3 curtidas novas. Veja quem são."

3. Oferta de retenção
   "Fica mais 3 meses por R$ 19,90"

4. Pesquisa de cancelamento
   "Por que você quer cancelar?"
```

---

## 📋 Pricing Strategy por Região

| Região | Preço Premium | Justificativa |
|--------|---------------|---------------|
| Brasil (SP/RJ) | R$ 29,90 | Mercado principal |
| Brasil (interior) | R$ 29,90 | Mesmo preço (simplicidade) |
| Portugal | € 9,90 | Poder aquisitivo menor |
| EUA (futuro) | $ 14.99 | Mercado internacional |
| Argentina | $ 4.99 | Câmbio |

---

## 🧾 Compliance Fiscal

- **MEI → Simples Nacional** (até R$ 81k/ano)
- **Lucro Presumido** (acima)
- **Nota fiscal** automática via Iugu (BRL)
- **Impostos:** ~6% (Simples) sobre receita
- **Stripe Atlas** se expandir internacional (CNPJ US)

---

## 🔮 Futuras Fontes de Receita

### V2 (ano 2)
- Anúncios sutis no Free (não invasivos)
- Patrocínio de eventos universitários
- Cruzei Gold (selo pago pra qualquer user)

### V3 (ano 3)
- Cruzei Concierge (matchmaker humano, R$ 500/sessão)
- Cruzei Travel (encontros em viagem, integração Airbnb)
- Cruzei Events (eventos próprios pagos)

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [13-estrutura-pastas.md](./13-estrutura-pastas.md)
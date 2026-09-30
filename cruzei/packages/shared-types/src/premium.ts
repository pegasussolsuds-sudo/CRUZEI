// Premium: planos, status da assinatura, teste grátis (trial) e invisível grátis. Rotas /v1/premium/*.
// Regras (o servidor decide; o app só mostra):
// - acesso SEMPRE pelo plano efetivo: assinatura vencida conta como 'free' em todo lugar (e a tarefa periódica rebaixa
//   no banco a cada minuto, avisando 'premium_expired' + socket 'account:changed').
// - teste grátis: uma vez por conta E por telefone (permanente); quem não pode mais recebe os planos sem trialDays.
// - invisível grátis: janela de ANON_FREE_HOURS; pode religar quando quiser; invisível grátis não conversa nem curte.
//   Premium vigente: invisível sem prazo. Premium que vence com a pessoa invisível → ganha a janela grátis (sem susto).
import type { PremiumTier } from './user';

/** duração da janela do invisível grátis (h) */
export const ANON_FREE_HOURS = 24;

/** item de GET /v1/premium/plans */
export interface PremiumPlan {
  id: string;
  tier: Exclude<PremiumTier, 'free'>;
  interval: 'month' | 'quarter' | 'year';
  priceCents: number;
  currency: string;
  /** dias de teste grátis; ausente = sem teste (ou a pessoa já usou o dela) */
  trialDays?: number;
  savingsPercent?: number;
}

/** GET /v1/premium/plans (autenticado: tira trialDays de quem não é elegível) */
export interface PremiumPlansResponse {
  plans: PremiumPlan[];
}

/** GET /v1/premium/status */
export interface PremiumStatus {
  /** plano EFETIVO */
  tier: PremiumTier;
  /** vencimento (ISO); ausente no free */
  expiresAt?: string;
  daysRemaining: number;
  /** está no período de teste grátis agora (subscriptions.trial_ends_at no futuro) */
  trialActive: boolean;
  /** fim do teste grátis em andamento (ISO); null = sem teste */
  trialEndsAt: string | null;
  /** ainda pode ganhar o teste grátis (conta e telefone nunca usaram) */
  trialEligible: boolean;
  /** false depois de cancelar: o acesso segue até expiresAt, mas não renova */
  autoRenew: boolean;
  cancelledAt: string | null;
}

/** POST /v1/premium/subscribe {planId, platform, receipt} */
export interface SubscribeResult {
  subscriptionId: string;
  tier: Exclude<PremiumTier, 'free'>;
  expiresAt: string;
  /** esta assinatura veio com teste grátis */
  trialActive: boolean;
}

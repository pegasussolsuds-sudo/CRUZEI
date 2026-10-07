import { Alert, AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type { AppNotification, PushData, RegisterDevicePayload, SocialPushType } from '@cruzei/shared-types';
import { api, getToken } from './api';
import { BRAND } from '../brand';
import {
  isSocialPush,
  parseTarget,
  presentedPushTag,
  pushDataOf,
  routeForPush,
  type PushNotificationLike,
  type TargetRoute,
} from './notificationTarget';

// Push pelo FCM direto (decisão do dono): o app manda o token NATIVO do aparelho (getDevicePushTokenAsync) pro
// POST /me/devices e o backend fala com o FCM HTTP v1. Sem o serviço da Expo. Só Android por enquanto: o token do iOS
// seria do APNs, que o backend não usa.
//
// Nada aqui pode derrubar o app: sem google-services.json (Firebase não inicializado) o token falha e só loga.

const PUSH_TOKEN_KEY = 'metch.pushToken';
/** a explicação + pedido do sistema aparece UMA vez por instalação (quem disse "agora não" ativa pela central) */
const ASKED_KEY = 'metch.pushAsked.v1';

export const CHANNELS = {
  /** avisos em geral (eventos perto, campanhas, Premium, lugar aprovado) */
  default: 'default',
  /** respostas do suporte */
  support: 'support',
  /** mensagem nova (push social) */
  messages: 'messages',
  /** curtida e match (push social) */
  social: 'social',
} as const;

const pushSupported = Platform.OS === 'android';

function log(msg: string, err?: unknown): void {
  // só em desenvolvimento: no APK cada console.* vira escrita no logcat (e breadcrumb do Sentry)
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.info(`[push] ${msg}`, err instanceof Error ? err.message : (err ?? ''));
}

// ───────────────────────────── app aberto ─────────────────────────────

/** push com o app na frente: vira o aviso rápido do app (o App liga depois do login) */
let foregroundHandler: ((n: AppNotification) => void) | null = null;
export function setForegroundPushHandler(fn: ((n: AppNotification) => void) | null): void {
  foregroundHandler = fn;
}

/**
 * Push social (mensagem, curtida, match) com o app na frente: não vira banner nem aviso rápido (o socket já atualizou
 * as listas). O App decide: true = tratado (silêncio); false = deixa o sistema mostrar (ex.: socket caído).
 */
export type SocialForegroundHandler = (data: PushData & { type: SocialPushType }) => boolean;
let socialForegroundHandler: SocialForegroundHandler | null = null;
export function setSocialForegroundHandler(fn: SocialForegroundHandler | null): void {
  socialForegroundHandler = fn;
}

const SILENT = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false } as const;

/**
 * Mensagem que o SISTEMA mostrou com o app na frente (socket caído): quem monta é o expo, sem o visibility 'secret' do
 * push, então ela apareceria na tela bloqueada depois. Sai da bandeja quando o app vai pro fundo (bloquear a tela
 * também manda pro fundo); a conversa segue como não lida no app.
 */
const foregroundShownMessages = new Set<string>();
AppState.addEventListener('change', (s) => {
  if (s !== 'background' || foregroundShownMessages.size === 0) return;
  const ids = [...foregroundShownMessages];
  foregroundShownMessages.clear();
  for (const id of ids) void Notifications.dismissNotificationAsync(id).catch(() => undefined);
});

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = pushDataOf(notification as PushNotificationLike);
    if (isSocialPush(data)) {
      let handled = false;
      try {
        handled = socialForegroundHandler?.(data) ?? false;
      } catch (e) {
        log('push social em primeiro plano falhou', e);
      }
      if (handled) return SILENT;
      if (data.type === 'message') foregroundShownMessages.add(notification.request.identifier);
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    }
    const handler = foregroundHandler;
    if (handler && data?.notificationId) {
      // app aberto e logado: o aviso é o do app (o mesmo do socket, sem repetir) e nada na barra do sistema
      const c = notification.request.content;
      handler({
        id: data.notificationId,
        type: data.type || 'campaign',
        title: c.title ?? BRAND.name,
        body: c.body ?? null,
        target: parseTarget(data.target),
        readAt: null,
        sentAt: new Date(notification.date || Date.now()).toISOString(),
      });
      return SILENT;
    }
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

// ───────────────────────────── canais e token ─────────────────────────────

let channelsReady: Promise<void> | null = null;
/**
 * Canais do Android 8+: o backend manda channel_id 'default', 'support', 'messages' ou 'social' (sem canal o sistema
 * joga em "Outros"). Cada um aparece nos ajustes do sistema e dá pra silenciar separado (ex.: só as curtidas).
 */
export function ensureChannels(): Promise<void> {
  if (!pushSupported) return Promise.resolve();
  if (!channelsReady) {
    channelsReady = Promise.all([
      Notifications.setNotificationChannelAsync(CHANNELS.messages, {
        name: 'Mensagens',
        description: 'Mensagens novas e solicitações de conversa',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 100, 180],
        lightColor: '#7FFF00',
        // aviso de mensagem nem aparece na tela bloqueada (só ao desbloquear). Quem garante é o visibility 'secret' que o
        // backend manda em cada push: o Android costuma ignorar o valor do canal pedido pelo app (e canal já criado não muda)
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.social, {
        name: 'Curtidas e matches',
        description: 'Quando alguém curte você e quando dá Metch',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 120, 80, 120, 80, 240],
        lightColor: '#FF1493',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.default, {
        name: 'Avisos',
        description: 'Eventos perto de você e novidades do Metch',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#7FFF00',
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.support, {
        name: 'Suporte',
        description: 'Respostas da Equipe Metch',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#7FFF00',
      }),
    ])
      .then(() => undefined)
      .catch((e) => {
        channelsReady = null;
        log('canais falharam', e);
      });
  }
  return channelsReady;
}

function appVersion(): string {
  const version = Constants.expoConfig?.version ?? BRAND.version;
  const build = Constants.expoConfig?.android?.versionCode;
  return build ? `${version} (${build})` : version;
}

let lastSent: string | null = null;
let inFlight: string | null = null;
let registering: Promise<void> | null = null;

async function sendToken(token: string): Promise<void> {
  // já registrado nesta sessão, ou indo agora (o getDevicePushTokenAsync também dispara o listener de token novo)
  if (token === lastSent || token === inFlight) return;
  // sem sessão não há pra quem registrar (logout em andamento, sessão caiu)
  if (!(await getToken())) return;
  inFlight = token;
  try {
    const payload: RegisterDevicePayload = { token, platform: 'android', appVersion: appVersion() };
    await api.post('/me/devices', payload);
    lastSent = token;
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token).catch(() => undefined);
  } finally {
    inFlight = null;
  }
}

/**
 * Logado e com permissão: pega o token do FCM e registra no servidor (idempotente: o backend faz upsert pelo token).
 * Roda a cada abertura logada; sem permissão não faz nada (quem pede é o askPushPermissionOnce).
 */
export function registerPushDevice(): Promise<void> {
  if (!pushSupported) return Promise.resolve();
  if (!registering) {
    registering = (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (!perm.granted) return;
        await ensureChannels();
        const t = await Notifications.getDevicePushTokenAsync();
        if (typeof t.data !== 'string' || !t.data) return;
        await sendToken(t.data);
      } catch (e) {
        // sem google-services.json / sem Play Services / sem rede: o app segue sem push (a central funciona)
        log('registro do aparelho falhou', e);
      } finally {
        registering = null;
      }
    })();
  }
  return registering;
}

/** o FCM trocou o token com o app aberto: manda o novo (o velho para de funcionar) */
export function listenPushTokenChanges(): () => void {
  if (!pushSupported) return () => undefined;
  const sub = Notifications.addPushTokenListener((t) => {
    if (typeof t.data !== 'string' || !t.data || t.data === lastSent) return;
    sendToken(t.data).catch((e) => log('token novo não foi registrado', e));
  });
  return () => sub.remove();
}

/**
 * Logout: tira o token deste aparelho da conta ANTES de derrubar a sessão (a rota precisa do login). Se o servidor
 * não responder, invalida o token no próprio FCM: celular compartilhado não recebe aviso da conta que saiu.
 */
export async function unregisterPushDevice(): Promise<void> {
  if (!pushSupported) return;
  const token = lastSent ?? (await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null));
  lastSent = null;
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => undefined);
  if (!token) return;
  try {
    await api.delete('/me/devices', { data: { token }, timeout: 5_000 });
  } catch (e) {
    log('não deu pra tirar o aparelho da conta; invalidando o token', e);
    await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
  }
}

// ───────────────────────────── permissão ─────────────────────────────

export type PushPermission = 'granted' | 'ask' | 'blocked' | 'unsupported';

/** estado pra tela de avisos: ativo, dá pra pedir, só pelos ajustes do sistema, ou sem push nesta plataforma */
export async function pushPermissionState(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'ask' : 'blocked';
  } catch {
    return 'blocked';
  }
}

/** pede ao sistema (canais antes: no Android 13 o pedido só aparece com um canal criado) e registra se deu */
export async function requestPushPermission(): Promise<boolean> {
  if (!pushSupported) return false;
  try {
    await ensureChannels();
    const res = await Notifications.requestPermissionsAsync();
    if (res.granted) void registerPushDevice();
    return res.granted;
  } catch (e) {
    log('pedido de permissão falhou', e);
    return false;
  }
}

let asking = false;
/**
 * O momento de pedir: depois que o mapa já carregou pela 1ª vez (quem chama decide o quando), com uma explicação curta
 * antes do pedido do sistema. UMA vez por instalação; já permitido (Android < 13 vem permitido) só registra.
 */
export async function askPushPermissionOnce(): Promise<void> {
  if (!pushSupported || asking) return;
  asking = true;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) {
      await registerPushDevice();
      return;
    }
    if (!perm.canAskAgain) return;
    if (await SecureStore.getItemAsync(ASKED_KEY).catch(() => null)) return;
    if (AppState.currentState !== 'active') return;
    await SecureStore.setItemAsync(ASKED_KEY, '1').catch(() => undefined);
    const yes = await new Promise<boolean>((resolve) =>
      Alert.alert(
        'Quer receber avisos?',
        'O Metch te avisa quando chegar mensagem, curtida ou match, quando rolar um evento perto de você e quando o suporte responder. Sem spam.',
        [
          { text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Quero', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );
    if (yes) await requestPushPermission();
  } catch (e) {
    log('pedido de permissão falhou', e);
  } finally {
    asking = false;
  }
}

// ───────────────────────────── bandeja ─────────────────────────────

/**
 * Tira da bandeja os pushes sociais com essa tag (conv:<id> ao abrir a conversa, match:<pessoa> ao comemorar): o que
 * a pessoa já está vendo no app não fica lá esperando. Sem permissão/sem suporte não faz nada.
 */
export async function dismissPushesTagged(tag: string): Promise<void> {
  if (!pushSupported || !tag) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const ids = presented
      .filter((n) => presentedPushTag(n as PushNotificationLike) === tag)
      .map((n) => n.request.identifier);
    await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id).catch(() => undefined)));
  } catch (e) {
    log('não deu pra limpar a bandeja', e);
  }
}

// ───────────────────────────── toque na notificação ─────────────────────────────

// O mesmo toque volta por vários caminhos: listener + "última resposta" do app frio, reload do JS e, o pior, o sistema
// matando o processo: o Android recria a tela com o intent antigo e o expo-notifications entrega o toque de novo (o
// clearLastNotificationResponse morre junto com o processo). Por isso os ids já tratados ficam gravados no aparelho.
const HANDLED_KEY = 'metch.pushHandled.v1';
/** quantos toques lembrar (o id do FCM é curto: 20 cabem folgado no SecureStore) */
export const HANDLED_MAX = 20;

/** lista gravada → ids (vazio, lixo ou formato estranho = lista vazia) */
export function parseHandledTaps(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(-HANDLED_MAX);
  } catch {
    return [];
  }
}

/** marca o toque: null se já foi tratado (repetido), senão a lista nova com só os últimos `max` */
export function rememberTap(list: readonly string[], id: string, max = HANDLED_MAX): string[] | null {
  if (list.includes(id)) return null;
  return [...list, id].slice(-Math.max(1, max));
}

let handledIds: string[] | null = null;
/** um toque por vez: o listener e a "última resposta" chegam juntos no app frio, com o mesmo id */
let tapQueue: Promise<void> = Promise.resolve();

/** true = toque novo (já gravado); false = repetido */
async function claimTap(id: string): Promise<boolean> {
  if (!handledIds) handledIds = parseHandledTaps(await SecureStore.getItemAsync(HANDLED_KEY).catch(() => null));
  const next = rememberTap(handledIds, id);
  if (!next) return false;
  handledIds = next;
  // grava antes de navegar: se o processo morrer logo depois, o toque não volta; se falhar, vale só nesta sessão
  await SecureStore.setItemAsync(HANDLED_KEY, JSON.stringify(next)).catch(() => undefined);
  return true;
}

function handleResponse(res: Notifications.NotificationResponse | null, onRoute: (route: TargetRoute, notificationId: string | null) => void): Promise<void> {
  if (!res || res.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return Promise.resolve();
  const data = pushDataOf(res.notification as PushNotificationLike);
  // o id do FCM (google.message_id) é o mesmo em todas as entregas do mesmo toque; sem ele, o id do aviso
  const id = res.notification.request.identifier || (data?.notificationId ? `n:${data.notificationId}` : '');
  tapQueue = tapQueue
    .then(async () => {
      if (id && !(await claimTap(id))) return;
      onRoute(routeForPush(data), data?.notificationId || null);
    })
    .catch((e) => log('toque na notificação falhou', e));
  return tapQueue;
}

/**
 * Toques: app quente (listener) e app frio (o toque que abriu o app). Quem chama guarda o destino até a navegação e o
 * login estarem prontos.
 */
export function listenNotificationTaps(onRoute: (route: TargetRoute, notificationId: string | null) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => handleResponse(res, onRoute));
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      const done = handleResponse(res, onRoute);
      // senão o mesmo toque volta num reload do JS (depois que o processo morre, quem segura é a lista gravada)
      if (res) return Promise.all([done, Notifications.clearLastNotificationResponseAsync()]).then(() => undefined);
      return done;
    })
    .catch((e) => log('última resposta indisponível', e));
  return () => sub.remove();
}

import { Alert, AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type { AppNotification, RegisterDevicePayload } from '@cruzei/shared-types';
import { api, getToken } from './api';
import { BRAND } from '../brand';
import { parseTarget, pushDataOf, routeForPush, type PushNotificationLike, type TargetRoute } from './notificationTarget';

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
} as const;

const pushSupported = Platform.OS === 'android';

function log(msg: string, err?: unknown): void {
  // eslint-disable-next-line no-console
  console.info(`[push] ${msg}`, err instanceof Error ? err.message : (err ?? ''));
}

// ───────────────────────────── app aberto ─────────────────────────────

/** push com o app na frente: vira o aviso rápido do app (o App liga depois do login) */
let foregroundHandler: ((n: AppNotification) => void) | null = null;
export function setForegroundPushHandler(fn: ((n: AppNotification) => void) | null): void {
  foregroundHandler = fn;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = pushDataOf(notification as PushNotificationLike);
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
      return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

// ───────────────────────────── canais e token ─────────────────────────────

let channelsReady: Promise<void> | null = null;
/** canais do Android 8+: o backend manda channel_id 'default' ou 'support' (sem canal o sistema joga em "Outros") */
export function ensureChannels(): Promise<void> {
  if (!pushSupported) return Promise.resolve();
  if (!channelsReady) {
    channelsReady = Promise.all([
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
        'O Metch te avisa quando rolar um evento perto de você e quando o suporte responder. Sem spam.',
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

// ───────────────────────────── toque na notificação ─────────────────────────────

const handled = new Set<string>();

function handleResponse(res: Notifications.NotificationResponse | null, onRoute: (route: TargetRoute, notificationId: string | null) => void): void {
  if (!res || res.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  // o mesmo toque pode vir pelos dois caminhos (listener e "última resposta" do app frio)
  const id = res.notification.request.identifier;
  if (id) {
    if (handled.has(id)) return;
    handled.add(id);
  }
  const data = pushDataOf(res.notification as PushNotificationLike);
  onRoute(routeForPush(data), data?.notificationId || null);
}

/**
 * Toques: app quente (listener) e app frio (o toque que abriu o app). Quem chama guarda o destino até a navegação e o
 * login estarem prontos.
 */
export function listenNotificationTaps(onRoute: (route: TargetRoute, notificationId: string | null) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => handleResponse(res, onRoute));
  Notifications.getLastNotificationResponseAsync()
    .then((res) => {
      handleResponse(res, onRoute);
      // senão o mesmo toque volta num reload do JS
      if (res) return Notifications.clearLastNotificationResponseAsync();
      return undefined;
    })
    .catch((e) => log('última resposta indisponível', e));
  return () => sub.remove();
}

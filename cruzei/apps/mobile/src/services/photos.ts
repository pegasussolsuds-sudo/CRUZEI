import * as ImagePicker from 'expo-image-picker';
import { api } from './api';

/** permissão de galeria/câmera negada (diferente de "cancelou") — a tela avisa e oferece os ajustes */
export class PhotoPermissionError extends Error {
  constructor(public readonly canAskAgain: boolean) {
    super('permission_denied');
  }
}

type AlertFn = (title: string, msg: string, buttons?: { text: string; onPress?: () => void; style?: 'cancel' | 'default' }[]) => void;

/** copy padrão pra permissão negada; abre os ajustes quando não dá mais pra perguntar */
export function explainPhotoPermission(err: PhotoPermissionError, alert: AlertFn, openSettings: () => void) {
  if (err.canAskAgain) {
    alert('Sem acesso às fotos', 'Precisamos da permissão pra você escolher uma foto. Tenta de novo e permite.');
  } else {
    alert('Sem acesso às fotos', 'A permissão está desligada nos ajustes do sistema.', [
      { text: 'Agora não', style: 'cancel' },
      { text: 'Abrir ajustes', onPress: openSettings },
    ]);
  }
}

export async function pickPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new PhotoPermissionError(perm.canAskAgain);
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [4, 5],
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PhotoPermissionError(perm.canAskAgain);
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [4, 5],
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

// Upload real precisaria de signed URL R2 — stub retorna URL local.
export async function uploadPhoto(localUri: string): Promise<{ url: string; thumbnailUrl?: string }> {
  const form = new FormData();
  form.append('file', { uri: localUri, name: 'photo.jpg', type: 'image/jpeg' } as never);
  const res = await api.post('/uploads/photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return { url: res.data.url, thumbnailUrl: res.data.thumbnailUrl };
}

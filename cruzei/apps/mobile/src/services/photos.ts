import * as ImagePicker from 'expo-image-picker';
import { api } from './api';

export async function pickPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
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
  if (!perm.granted) return null;
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

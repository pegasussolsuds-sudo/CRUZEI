import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('./api', () => ({ api: { post: jest.fn() } }));

import { PhotoPermissionError, pickPhoto } from './photos';

const picker = jest.mocked(ImagePicker);
const picked = { canceled: false, assets: [{ uri: 'file:///foto.jpg' }] } as unknown as ImagePicker.ImagePickerResult;

beforeEach(() => {
  jest.clearAllMocks();
  picker.launchImageLibraryAsync.mockResolvedValue(picked);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pickPhoto: permissão da galeria', () => {
  it('Android: não pede permissão (o seletor do sistema não precisa) e abre a galeria', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await expect(pickPhoto()).resolves.toBe('file:///foto.jpg');
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });

  it('iOS: negado → PhotoPermissionError e a galeria não abre', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never);
    const err = await pickPhoto().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoPermissionError);
    expect((err as PhotoPermissionError).canAskAgain).toBe(false);
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('iOS: permitido → abre a galeria; cancelou → null', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never);
    await expect(pickPhoto()).resolves.toBeNull();
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

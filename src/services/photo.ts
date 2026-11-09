import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Photo markers keep the picture in one Firestore doc (rules: under 400 KB of text). */
const MAX_CHARS = 380_000;
const STEPS = [
  { width: 1280, compress: 0.55 },
  { width: 1024, compress: 0.45 },
  { width: 800, compress: 0.4 },
];

/** Takes a photo with the camera; returns a JPEG data URI, or null if cancelled. */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Нет доступа к камере — разрешите его в настройках телефона');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  for (const step of STEPS) {
    const ctx = ImageManipulator.manipulate(asset.uri);
    // Never upscale; keep landscape shots landscape.
    if ((asset.width ?? step.width + 1) > step.width) ctx.resize({ width: step.width });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: step.compress, base64: true });
    if (saved.base64 && saved.base64.length + 30 < MAX_CHARS) return `data:image/jpeg;base64,${saved.base64}`;
  }
  throw new Error('Фото слишком большое');
}

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Avatars are small JPEG data URIs (a few KB) so they fit in a Firestore doc. */
const SIZE = 128;

export type PickedPhoto = { uri: string; width: number; height: number };
export type CropRect = { originX: number; originY: number; width: number; height: number };

/**
 * Picks a photo without the system editor: its crop isn't always square (iPad) and
 * shows no circle. `AvatarCropper` frames it in a circle instead.
 */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  if (a.width && a.height) return { uri: a.uri, width: a.width, height: a.height };
  // Some platforms leave the size out: render once to learn it.
  const img = await ImageManipulator.manipulate(a.uri).renderAsync();
  return { uri: a.uri, width: img.width, height: img.height };
}

/** The square under the circle → a 128 px JPEG data URI. */
export async function cropAvatar(photo: PickedPhoto, rect: CropRect): Promise<string> {
  const side = Math.max(1, Math.floor(Math.min(rect.width, rect.height, photo.width, photo.height)));
  const originX = Math.min(Math.max(0, Math.round(rect.originX)), photo.width - side);
  const originY = Math.min(Math.max(0, Math.round(rect.originY)), photo.height - side);
  const rendered = await ImageManipulator.manipulate(photo.uri)
    .crop({ originX, originY, width: side, height: side })
    .resize({ width: SIZE, height: SIZE })
    .renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64) throw new Error('Не удалось обработать фото');
  return `data:image/jpeg;base64,${saved.base64}`;
}

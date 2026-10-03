import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Avatars are small JPEG data URIs (a few KB) so they fit in a Firestore doc. */
const SIZE = 128;

/** Lets the user pick and crop a photo; returns a data URI, or null if cancelled. */
export async function pickAvatar(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;

  const rendered = await ImageManipulator.manipulate(res.assets[0].uri)
    .resize({ width: SIZE, height: SIZE })
    .renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64) throw new Error('Не удалось обработать фото');
  return `data:image/jpeg;base64,${saved.base64}`;
}

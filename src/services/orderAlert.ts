import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Vibration } from 'react-native';

let player: AudioPlayer | null = null;

/**
 * Silent-ish heads-up for a new order: vibration pattern plus an optional chirp.
 * No popups — the player keeps their eyes where they are.
 */
export function signalNewOrder(withSound: boolean): void {
  // Android (and browsers with navigator.vibrate) honour the pattern; iOS vibrates once.
  Vibration.vibrate([0, 250, 120, 250, 120, 400]);
  if (!withSound) return;
  try {
    if (!player) player = createAudioPlayer(require('../../assets/sounds/order.wav'));
    player.seekTo(0).catch(() => {});
    // On web play() returns a promise that rejects until the user has interacted with the page.
    const played: unknown = player.play();
    if (played instanceof Promise) played.catch(() => {});
  } catch {
    // Audio is best-effort; the vibration already went out.
  }
}

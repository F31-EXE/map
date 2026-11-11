import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';

import { KEYS, loadJson, saveJson } from '../lib/storage';

/**
 * Spoken hints (navigation, SOS) on/off, app-wide (Settings → «Голосовые подсказки»),
 * and the one place that talks.
 */
let voice = true;
let loaded = false;
const listeners = new Set<(v: boolean) => void>();

function emit() {
  for (const l of listeners) l(voice);
}

function load() {
  if (loaded) return;
  loaded = true;
  loadJson<boolean>(KEYS.voice, true).then((saved) => {
    voice = saved;
    emit();
  });
}
load();

export function setVoice(v: boolean) {
  voice = v;
  emit();
  saveJson(KEYS.voice, v).catch(() => {});
  if (!v) Speech.stop().catch(() => {});
}

export function useVoice(): boolean {
  const [v, setV] = useState(voice);
  useEffect(() => {
    listeners.add(setV);
    setV(voice);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** Says `text` in Russian, cutting off whatever was being said. No-op when turned off. */
export function say(text: string, urgent = false): void {
  if (!voice) return;
  try {
    Speech.stop().catch(() => {});
    Speech.speak(text, { language: 'ru-RU', rate: urgent ? 1.05 : 1 });
  } catch {
    // No speech engine: stay silent.
  }
}

import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';

import { KEYS, loadJson, saveJson } from '../lib/storage';

/**
 * Spoken hints (navigation, SOS) on/off, app-wide (Settings → «Голосовые подсказки»),
 * and the one place that talks.
 */
let voice = true;
/** Volume of spoken hints and the order chirp, 0.1–1. */
let volume = 1;
let loaded = false;
const listeners = new Set<(v: boolean) => void>();
const volumeListeners = new Set<(v: number) => void>();

function emit() {
  for (const l of listeners) l(voice);
  for (const l of volumeListeners) l(volume);
}

function load() {
  if (loaded) return;
  loaded = true;
  loadJson<boolean>(KEYS.voice, true).then((saved) => {
    voice = saved;
    emit();
  });
  loadJson<number>(KEYS.volume, 1).then((saved) => {
    volume = Math.min(1, Math.max(0.1, Number(saved) || 1));
    emit();
  });
}

export const getVolume = () => volume;

export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0.1, v));
  emit();
  saveJson(KEYS.volume, volume).catch(() => {});
}

export function useVolume(): number {
  const [v, setV] = useState(volume);
  useEffect(() => {
    volumeListeners.add(setV);
    setV(volume);
    return () => {
      volumeListeners.delete(setV);
    };
  }, []);
  return v;
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
    Speech.speak(text, { language: 'ru-RU', rate: urgent ? 1.05 : 1, volume });
  } catch {
    // No speech engine: stay silent.
  }
}

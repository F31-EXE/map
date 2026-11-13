import Constants from 'expo-constants';
import { doc, getDocFromServer } from 'firebase/firestore';
import { useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';

import { firebaseAuth, firestore, isFirebaseConfigured, withTimeout } from '../lib/firebase';

import { Button, Card, Eyebrow } from './components';
import { C, F } from './theme';

type Step = { name: string; ok: boolean; detail: string };

/**
 * Settings → «Проверка связи с сервером»: sign-in, reaching Firestore's host, and a
 * real read from the server, each with its error text — for when writes hang on one
 * phone and work on another.
 */
export function ConnectionCheck() {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);

  const run = async () => {
    setBusy(true);
    const out: Step[] = [];
    const push = (s: Step) => {
      out.push(s);
      setSteps([...out]);
    };
    try {
      push({ name: 'Настройки сервера', ok: isFirebaseConfigured, detail: isFirebaseConfigured ? 'есть' : 'нет в сборке' });
      const user = isFirebaseConfigured ? firebaseAuth().currentUser : null;
      push({ name: 'Вход', ok: Boolean(user), detail: user ? `id ${user.uid.slice(0, 6)}…` : 'не выполнен' });
      const t0 = Date.now();
      try {
        const r = await withTimeout(fetch('https://firestore.googleapis.com/'), 10_000);
        push({ name: 'Сервер базы доступен', ok: true, detail: `HTTP ${r.status}, ${Date.now() - t0} мс` });
      } catch (e) {
        push({ name: 'Сервер базы доступен', ok: false, detail: (e as Error).message });
      }
      if (isFirebaseConfigured) {
        const t1 = Date.now();
        try {
          // Any answer from the server will do, even «not found» or «no access».
          await withTimeout(getDocFromServer(doc(firestore(), 'teamCodes', 'PING00')), 15_000);
          push({ name: 'Чтение из базы', ok: true, detail: `${Date.now() - t1} мс` });
        } catch (e) {
          const err = e as { code?: string; message?: string };
          const reached = err.code === 'permission-denied' || err.code === 'not-found';
          push({
            name: 'Чтение из базы',
            ok: reached,
            detail: reached ? `ответ получен (${err.code}), ${Date.now() - t1} мс` : `${err.code ?? ''} ${err.message ?? ''}`.trim(),
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const report = () =>
    [
      `GrimMap ${Constants.expoConfig?.version} · ${Platform.OS} ${Platform.Version}`,
      ...steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}: ${s.detail}`),
    ].join('\n');

  return (
    <Card style={{ gap: 10 }}>
      <Eyebrow>Проверка связи с сервером</Eyebrow>
      {steps.map((s) => (
        <View key={s.name} style={styles.row}>
          <Text style={[styles.mark, { color: s.ok ? C.accent : C.danger }]}>{s.ok ? '✓' : '✗'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.detail} selectable>
              {s.detail}
            </Text>
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={steps.length ? 'Ещё раз' : 'Проверить'} icon="lan-check" kind="secondary" busy={busy} style={{ flex: 1 }} onPress={run} />
        {steps.length > 0 && !busy && (
          <Button title="Отправить" icon="share-variant" kind="secondary" style={{ flex: 1 }} onPress={() => Share.share({ message: report() })} />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  mark: { fontSize: 18, fontFamily: F.bold, width: 18 },
  name: { color: C.text, fontSize: 14, fontFamily: F.semibold },
  detail: { color: C.dim, fontSize: 12, fontFamily: F.mono },
});

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatClock } from '../lib/geo';
import type { TacMarker } from '../lib/types';
import { formatCountdown, nextWave, shiftWave, upcomingWaves, WAVE_PRESETS_MIN, type Wave } from '../lib/waves';

import { Button, Eyebrow, Icon, tap } from './components';
import { C, F, R } from './theme';

const MIN = 60_000;

/** Respawn departures on a respawn / dead-zone marker: live countdown, commander controls. */
export function WavePanel({
  marker,
  canEdit,
  onSet,
}: {
  marker: TacMarker;
  canEdit: boolean;
  onSet: (w: Wave | null) => void;
}) {
  const wave = marker.wave ?? null;
  const [now, setNow] = useState(Date.now());
  const [every, setEvery] = useState(wave ? Math.round(wave.every / MIN) : 15);
  useEffect(() => {
    if (!wave) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wave]);
  useEffect(() => {
    if (wave) setEvery(Math.round(wave.every / MIN));
  }, [wave]);

  if (!wave && !canEdit) {
    return <Text style={styles.hint}>Командир может задать здесь расписание выходов групп с респа.</Text>;
  }

  const next = wave ? nextWave(wave, now) : null;
  const left = next != null ? next - now : 0;
  const soon = next != null && left <= MIN;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Icon name="helicopter" size={20} color={soon ? C.warn : '#2EE6C5'} />
        <Eyebrow>Выходы с респа</Eyebrow>
      </View>

      {wave && next != null && (
        <View style={styles.countRow}>
          <Text style={[styles.count, soon && { color: C.warn }]}>{formatCountdown(left)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.line}>Следующая группа в {formatClock(next)}</Text>
            <Text style={styles.sub}>
              каждые {Math.round(wave.every / MIN)} мин · потом{' '}
              {upcomingWaves(wave, now, 3)
                .slice(1)
                .map((t) => formatClock(t))
                .join(', ')}
            </Text>
          </View>
        </View>
      )}

      {canEdit && (
        <>
          <View style={styles.chips}>
            {WAVE_PRESETS_MIN.map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  tap();
                  setEvery(m);
                  // Changing the interval keeps the last departure as the reference.
                  if (wave) onSet({ every: m * MIN, start: nextWave(wave, Date.now()) - wave.every });
                }}
                style={[styles.chip, every === m && styles.chipOn]}
              >
                <Text style={[styles.chipText, every === m && { color: C.accentInk }]}>{m} мин</Text>
              </Pressable>
            ))}
          </View>
          <Button
            title={wave ? 'Группа вышла сейчас' : 'Запустить: группа вышла сейчас'}
            icon="timer-play-outline"
            onPress={() => onSet({ every: every * MIN, start: Date.now() })}
          />
          {wave && (
            <View style={styles.row}>
              <Button
                title="−1 мин"
                kind="secondary"
                style={{ flex: 1, minHeight: 44 }}
                onPress={() => onSet(shiftWave(wave, -MIN))}
              />
              <Button
                title="+1 мин"
                kind="secondary"
                style={{ flex: 1, minHeight: 44 }}
                onPress={() => onSet(shiftWave(wave, MIN))}
              />
              <Button title="Убрать" kind="ghost" style={{ minHeight: 44 }} onPress={() => onSet(null)} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 12,
    padding: 14,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: 'rgba(46, 230, 197, 0.35)',
    backgroundColor: 'rgba(46, 230, 197, 0.06)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  count: { color: '#2EE6C5', fontFamily: F.mono, fontSize: 34 },
  line: { color: C.text, fontFamily: F.semibold, fontSize: 15 },
  sub: { color: C.dim, fontFamily: F.regular, fontSize: 13, marginTop: 2 },
  hint: { color: C.dim, fontFamily: F.regular, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    justifyContent: 'center',
    backgroundColor: C.elevated,
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontFamily: F.mono, fontSize: 13 },
  row: { flexDirection: 'row', gap: 8 },
});

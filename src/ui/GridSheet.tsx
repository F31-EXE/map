import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatCoords } from '../lib/geo';
import type { GridMode, LatLng } from '../lib/types';

import { Button, Eyebrow, Icon, Sheet, tap, type IconName } from './components';
import { C, F, R } from './theme';

const MODES: { id: GridMode; title: string; sub: string; icon: IconName }[] = [
  { id: 'off', title: 'Без сетки', sub: 'Только карта', icon: 'grid-off' },
  { id: 'utm', title: 'Сетка UTM', sub: 'Километровые квадраты, цифры по краям', icon: 'grid' },
  { id: 'snail', title: 'Улитка 500 м', sub: 'Квадраты А1, Б2… и деление 3×3 по улитке', icon: 'grid-large' },
];

/** Picks the grid over the map; for the snail grid, where square А1 starts. */
export function GridSheet({
  visible,
  mode,
  origin,
  canPlace,
  onMode,
  onPlace,
  onReset,
  onClose,
}: {
  visible: boolean;
  mode: GridMode;
  origin: LatLng | null;
  /** Commanders (or anyone outside a squad) may move square А1. */
  canPlace: boolean;
  onMode: (m: GridMode) => void;
  onPlace: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Сетка</Text>
      <View style={{ gap: 8 }}>
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                tap();
                onMode(m.id);
              }}
              style={[styles.option, on && styles.optionOn]}
            >
              <Icon name={m.icon} size={22} color={on ? C.accent : C.text} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{m.title}</Text>
                <Text style={styles.sub}>{m.sub}</Text>
              </View>
              {on && <Icon name="check-circle" size={20} color={C.accent} />}
            </Pressable>
          );
        })}
      </View>
      {mode === 'snail' && (
        <View style={{ gap: 10 }}>
          <Eyebrow>Квадрат А1</Eyebrow>
          <View style={styles.snail}>
            {[1, 2, 3, 8, 9, 4, 7, 6, 5].map((n) => (
              <View key={n} style={styles.snailCell}>
                <Text style={styles.snailNum}>{n}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.sub}>
            Квадраты 500 м: буквы слева направо, цифры сверху вниз. Каждый делится на 9 частей по улитке, каждая часть
            ещё на 9. Квадрат перекрестия виден внизу экрана, например «Б3-7-4».
          </Text>
          <Text style={styles.sub}>
            {origin
              ? `Левый верхний угол А1: ${formatCoords(origin)}. ${canPlace ? '' : 'Его задал командир, у всего отряда сетка одна.'}`
              : canPlace
                ? 'Начало не задано: квадраты считаются от блоков по 5 км. Поставьте левый верхний угол полигона в перекрестие и задайте А1 — сетка станет общей для отряда.'
                : 'Командир ещё не задал начало сетки, пока квадраты считаются от блоков по 5 км.'}
          </Text>
          {canPlace && (
            <View style={styles.row}>
              <Button
                title="А1 от перекрестия"
                icon="crosshairs"
                style={{ flex: 1.4 }}
                onPress={() => {
                  onPlace();
                  onClose();
                }}
              />
              {origin && <Button title="Сбросить" kind="secondary" style={{ flex: 1 }} onPress={onReset} />}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: R.md,
    backgroundColor: C.elevated,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  optionOn: { borderColor: C.accent, backgroundColor: C.accentSoft },
  optionTitle: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  row: { flexDirection: 'row', gap: 10 },
  snail: { width: 108, flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1.5, borderColor: '#FFC83D' },
  snailCell: {
    width: 35,
    height: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 200, 61, 0.5)',
  },
  snailNum: { color: '#FFC83D', fontFamily: F.mono, fontSize: 15 },
});

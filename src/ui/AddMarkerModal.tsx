import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatCoords } from '../lib/geo';
import { ADMIN_KINDS, isOrder, MARKER_KINDS, MARKER_KIND_ORDER, ORDER_KINDS } from '../lib/markerKinds';
import { newZone, type HotZone } from '../lib/hotzone';
import { WAVE_PRESETS_MIN } from '../lib/waves';
import type { LatLng, MarkerKind } from '../lib/types';
import type { MarkerScope } from '../state/session';
import type { OrderTarget } from '../state/side';
import { Button, Eyebrow, Icon, Sheet, tap, type IconName } from './components';
import { HOT, ZoneSettings } from './ZonePanel';
import { C, F, R } from './theme';

const TERRITORY_SIZES = [100, 150, 200, 300];

/** Game modes a game tech places from here (into the game, not the squad). */
export const GAME_KINDS: MarkerKind[] = ['hotzone', 'flag', 'sector'];

export function AddMarkerModal({
  at,
  inTeam,
  canCommand,
  isTech,
  orderTargets,
  onCancel,
  onSave,
}: {
  at: LatLng | null;
  inTeam: boolean;
  /** Shows the orders row (move / attack / defend). */
  canCommand: boolean;
  /** Game tech: shows the game modes (control zone, flag, territories). */
  isTech: boolean;
  /** Who an order can go to; more than one shows a picker (side commander). */
  orderTargets: { id: OrderTarget; label: string; color?: string }[];
  onCancel: () => void;
  onSave: (
    kind: MarkerKind,
    label: string,
    scope: MarkerScope,
    target: OrderTarget,
    waveMin: number | null,
    zone: HotZone | null,
    /** Territories: side of one of the nine squares, m. */
    territorySize: number
  ) => Promise<void>;
}) {
  const [kind, setKind] = useState<MarkerKind>('enemy');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<MarkerScope>('team');
  const [target, setTarget] = useState<OrderTarget>(orderTargets[0]?.id ?? 'own');
  const [busy, setBusy] = useState(false);
  // Respawn departures (commanders, respawn / dead-zone markers in the squad).
  const [waveMin, setWaveMin] = useState<number | null>(null);
  // Control zone settings (commanders, `hotzone` marker).
  const [zone, setZone] = useState<HotZone>(() => newZone());
  const [territorySize, setTerritorySize] = useState(150);

  useEffect(() => {
    if (at) {
      setLabel('');
      setWaveMin(null);
      setZone((z) => newZone(z.r, z.hot, Math.round(z.every / 60_000)));
    }
  }, [at]);

  // Keep the target valid when squads join or leave the side.
  useEffect(() => {
    if (!orderTargets.some((t) => t.id === target)) setTarget(orderTargets[0]?.id ?? 'own');
  }, [orderTargets, target]);

  const order = isOrder(kind);
  // Orders always go out; plain markers without a team are personal.
  const isZone = kind === 'hotzone';
  const isGame = GAME_KINDS.includes(kind);
  const effectiveScope: MarkerScope = order || isGame ? 'team' : !inTeam ? 'personal' : scope;

  const canWave = canCommand && inTeam && effectiveScope === 'team' && (kind === 'respawn' || kind === 'deadzone');

  const save = async () => {
    setBusy(true);
    try {
      // The schedule starts when the zone is placed.
      const z = isZone ? { ...zone, start: Date.now() } : null;
      await onSave(kind, label, effectiveScope, target, canWave ? waveMin : null, z, territorySize);
    } finally {
      setBusy(false);
    }
  };

  const pick = (k: MarkerKind) => {
    tap();
    setKind(k);
  };

  const active = MARKER_KINDS[kind];

  return (
    <Sheet visible={!!at} onClose={onCancel}>
      <View>
        <Text style={styles.title}>{order ? 'Приказ' : 'Новая метка'}</Text>
        {at && <Text style={styles.coords}>{formatCoords(at)}</Text>}
      </View>

      {canCommand && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Приказ · вибро и звук</Eyebrow>
          <View style={styles.orders}>
            {ORDER_KINDS.map((k) => {
              const def = MARKER_KINDS[k];
              const selected = k === kind;
              return (
                <Pressable
                  key={k}
                  onPress={() => pick(k)}
                  style={[styles.order, selected && { borderColor: def.color, backgroundColor: def.color + '1F' }]}
                >
                  <View
                    style={[
                      styles.orderIcon,
                      { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' },
                    ]}
                  >
                    <Icon name={def.icon} size={18} color={selected ? C.accentInk : def.color} />
                  </View>
                  <Text style={[styles.orderText, selected && { color: C.text }]} numberOfLines={2}>
                    {def.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {order && orderTargets.length > 1 && (
            <View style={styles.targets}>
              {orderTargets.map((t) => {
                const selected = t.id === target;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => {
                      tap();
                      setTarget(t.id);
                    }}
                    style={[styles.target, selected && styles.targetActive]}
                  >
                    {t.color && <View style={[styles.targetDot, { backgroundColor: t.color }]} />}
                    <Text style={[styles.targetText, selected && { color: C.accentInk }]} numberOfLines={1}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Eyebrow>Метка</Eyebrow>
        <View style={styles.grid}>
          {[...MARKER_KIND_ORDER, null].map((k) => {
            // Trailing spacer keeps the last row's tiles the same width as the first.
            if (!k) return <View key="spacer" style={[styles.kind, styles.spacer]} />;
            const def = MARKER_KINDS[k];
            const selected = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => pick(k)}
                style={[styles.kind, selected && { borderColor: def.color, backgroundColor: def.color + '1F' }]}
              >
                <View
                  style={[
                    styles.kindIcon,
                    { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' },
                  ]}
                >
                  <Icon name={def.icon} size={20} color={selected ? C.accentInk : def.color} />
                </View>
                <Text style={[styles.kindText, selected && { color: C.text }]} numberOfLines={1}>
                  {def.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Полигон</Eyebrow>
        <View style={styles.grid}>
          {ADMIN_KINDS.map((k) => {
            const def = MARKER_KINDS[k];
            const selected = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => pick(k)}
                style={[styles.kind, selected && { borderColor: def.color, backgroundColor: def.color + '1F' }]}
              >
                <View
                  style={[
                    styles.kindIcon,
                    styles.kindIconSquare,
                    { borderColor: def.color, backgroundColor: selected ? def.color : 'transparent' },
                  ]}
                >
                  <Icon name={def.icon} size={20} color={selected ? C.accentInk : def.color} />
                </View>
                <Text style={[styles.kindText, selected && { color: C.text }]} numberOfLines={1}>
                  {def.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isTech && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Игра · для всех сторон</Eyebrow>
          <GameTile
            on={isZone}
            color={HOT}
            icon="fire"
            title="Зона контроля с хотзоной"
            sub="Большой круг здесь, внутри него переезжает горячий круг"
            onPress={() => pick('hotzone')}
          />
          {isZone && <ZoneSettings zone={zone} onChange={setZone} />}
          <GameTile
            on={kind === 'flag'}
            color={MARKER_KINDS.flag.color}
            icon="flag"
            title="Флаг"
            sub="Боец рядом нажимает «Захватить»; очки за минуты удержания"
            onPress={() => pick('flag')}
          />
          <GameTile
            on={kind === 'sector'}
            color="#FFC83D"
            icon="hexagon-outline"
            title="Захват территорий · 9 зон"
            sub="Квадрат 3×3 с центром здесь; захват — перевес бойцов 3 минуты"
            onPress={() => pick('sector')}
          />
          {kind === 'sector' && (
            <View style={styles.waveRow}>
              {TERRITORY_SIZES.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => {
                    tap();
                    setTerritorySize(m);
                  }}
                  style={[styles.waveChip, m === territorySize && styles.waveChipOn]}
                >
                  <Text style={[styles.waveText, m === territorySize && { color: C.accentInk }]}>
                    {m} м · поле {m * 3} м
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {canWave && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Выходы с респа · отсчёт с момента установки</Eyebrow>
          <View style={styles.waveRow}>
            {[null, ...WAVE_PRESETS_MIN].map((m) => {
              const selected = m === waveMin;
              return (
                <Pressable
                  key={String(m)}
                  onPress={() => {
                    tap();
                    setWaveMin(m);
                  }}
                  style={[styles.waveChip, selected && styles.waveChipOn]}
                >
                  <Text style={[styles.waveText, selected && { color: C.accentInk }]}>{m ? `${m} мин` : 'Нет'}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {inTeam && !order && !isGame && (
        <View style={styles.segment}>
          {(['team', 'personal'] as const).map((sc) => {
            const selected = effectiveScope === sc;
            return (
              <Pressable
                key={sc}
                onPress={() => {
                  tap();
                  setScope(sc);
                }}
                style={[styles.segmentItem, selected && styles.segmentActive]}
              >
                <Icon
                  name={sc === 'team' ? 'account-group' : 'eye-off-outline'}
                  size={16}
                  color={selected ? C.accentInk : C.dim}
                />
                <Text style={[styles.segmentText, selected && { color: C.accentInk }]}>
                  {sc === 'team' ? 'Бойцам' : 'Только мне'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder={order ? 'Пояснение: «зайти с фланга»…' : 'Подпись: «пулемёт», «вход в здание»…'}
        placeholderTextColor={C.faint}
        maxLength={40}
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={save}
        selectionColor={C.accent}
      />
      <View style={styles.row}>
        <Button title="Отмена" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={order ? 'Отдать приказ' : kind === 'sector' ? 'Разметить' : isGame ? 'Поставить для игры' : 'Поставить'}
          icon={active.icon}
          onPress={save}
          busy={busy}
          style={{ flex: 1.4 }}
        />
      </View>
    </Sheet>
  );
}

function GameTile({
  on,
  color,
  icon,
  title,
  sub,
  onPress,
}: {
  on: boolean;
  color: string;
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.zoneTile, on && { borderColor: color, backgroundColor: color + '1F' }]}>
      <View style={[styles.kindIcon, { borderColor: color, backgroundColor: on ? color : 'transparent' }]}>
        <Icon name={icon} size={20} color={on ? C.accentInk : color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.zoneTitle, on && { color: C.text }]}>{title}</Text>
        <Text style={styles.zoneSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  coords: { color: C.dim, fontSize: 12, fontFamily: F.mono, marginTop: 2 },
  orders: { flexDirection: 'row', gap: 8 },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.pill,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.line,
  },
  targetActive: { backgroundColor: C.accent, borderColor: C.accent },
  targetDot: { width: 10, height: 10, borderRadius: 5 },
  targetText: { color: C.dim, fontSize: 13, fontFamily: F.semibold, maxWidth: 160 },
  order: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  orderIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  orderText: { color: C.dim, fontSize: 12, fontFamily: F.semibold, flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: {
    flexBasis: '22%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  spacer: { opacity: 0, borderWidth: 0 },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindIconSquare: { borderRadius: 8 },
  kindText: { color: C.dim, fontSize: 12, fontFamily: F.semibold },
  zoneTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  zoneTitle: { color: C.dim, fontSize: 14, fontFamily: F.semibold },
  zoneSub: { color: C.faint, fontSize: 12, fontFamily: F.regular, marginTop: 2 },
  waveRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  waveChip: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    justifyContent: 'center',
    backgroundColor: C.elevated,
  },
  waveChipOn: { backgroundColor: C.accent, borderColor: C.accent },
  waveText: { color: C.text, fontFamily: F.mono, fontSize: 13 },
  segment: { flexDirection: 'row', backgroundColor: C.elevated, borderRadius: R.md, padding: 4 },
  segmentItem: {
    flex: 1,
    height: 40,
    borderRadius: R.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.dim, fontSize: 14, fontFamily: F.semibold },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  row: { flexDirection: 'row', gap: 10 },
});

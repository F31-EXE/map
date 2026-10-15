import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bearingDegrees, distanceMeters, formatDistance } from '../lib/geo';
import { HOT_RADII, hotState, newZone, ZONE_EVERY_MIN, ZONE_RADII, type HotState, type HotZone } from '../lib/hotzone';
import type { LatLng, TacMarker } from '../lib/types';
import { formatCountdown } from '../lib/waves';

import { Button, Eyebrow, Icon, tap } from './components';
import { C, F, R } from './theme';

export const HOT = '#FF5A1F';
const MIN = 60_000;

/** Ticks once a second while mounted. */
export function useNow(on = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** "Сдвиг через 3:20" and friends. */
export function phaseText(st: HotState, now: number): string {
  const left = formatCountdown(st.at - now);
  if (st.phase === 'hold') return `новая точка через ${left}`;
  if (st.phase === 'warn') return `сдвиг через ${left}`;
  return `едет · ${left}`;
}

/** Where I am relative to the hot zone and the control zone. */
export function selfInZone(self: LatLng | null, m: TacMarker, st: HotState) {
  if (!self || !m.zone) return null;
  const toHot = distanceMeters(self, st);
  const toArea = distanceMeters(self, m);
  return {
    inHot: toHot <= m.zone.hot,
    inArea: toArea <= m.zone.r,
    toHotEdge: Math.max(0, toHot - m.zone.hot),
    bearing: bearingDegrees(self, st),
  };
}

function Chips<T extends number>({
  values,
  value,
  unit,
  disabled,
  onPick,
}: {
  values: T[];
  value: T;
  unit: string;
  disabled?: (v: T) => boolean;
  onPick: (v: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {values.map((v) => {
        const off = disabled?.(v) ?? false;
        const on = v === value;
        return (
          <Pressable
            key={v}
            disabled={off}
            onPress={() => {
              tap();
              onPick(v);
            }}
            style={[styles.chip, on && styles.chipOn, off && { opacity: 0.35 }]}
          >
            <Text style={[styles.chipText, on && { color: C.accentInk }]}>
              {v} {unit}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Zone size, hot zone size and relocation interval. */
export function ZoneSettings({ zone, onChange }: { zone: HotZone; onChange: (z: HotZone) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Eyebrow>Зона контроля · радиус</Eyebrow>
      <Chips
        values={ZONE_RADII}
        value={zone.r}
        unit="м"
        onPick={(r) => onChange({ ...zone, r, hot: Math.min(zone.hot, r / 2) })}
      />
      <Eyebrow>Хотзона · радиус</Eyebrow>
      <Chips
        values={HOT_RADII}
        value={zone.hot}
        unit="м"
        disabled={(h) => h > zone.r / 2}
        onPick={(hot) => onChange({ ...zone, hot })}
      />
      <Eyebrow>Хотзона переезжает каждые</Eyebrow>
      <Chips
        values={ZONE_EVERY_MIN}
        value={Math.round(zone.every / MIN)}
        unit="мин"
        onPick={(m) => onChange({ ...zone, every: m * MIN })}
      />
    </View>
  );
}

/** Marker card of a control zone: live state, my position, commander settings. */
export function ZonePanel({
  marker,
  self,
  canEdit,
  onSet,
}: {
  marker: TacMarker;
  self: LatLng | null;
  canEdit: boolean;
  onSet: (z: HotZone) => void;
}) {
  const now = useNow();
  const zone = marker.zone;
  if (!zone) return null;
  const st = hotState(marker, zone, now);
  const me = selfInZone(self, marker, st);
  const alert = st.phase !== 'hold';

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Icon name="fire" size={20} color={HOT} />
        <Eyebrow>Хотзона</Eyebrow>
      </View>
      <View style={styles.countRow}>
        <Text style={[styles.count, alert && { color: C.warn }]}>{formatCountdown(st.at - now)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.line}>
            {st.phase === 'hold' ? 'Держится на месте' : st.phase === 'warn' ? 'Новая точка видна на карте' : 'Переезжает'}
          </Text>
          <Text style={styles.sub}>{phaseText(st, now)}</Text>
        </View>
      </View>
      {me && (
        <Text style={[styles.me, me.inHot && { color: HOT }]}>
          {me.inHot
            ? 'Вы в хотзоне'
            : `До хотзоны ${formatDistance(me.toHotEdge)} · ${Math.round(me.bearing)}°${me.inArea ? '' : ' · вы вне зоны контроля'}`}
        </Text>
      )}
      <Text style={styles.sub}>
        Зона {zone.r} м · хотзона {zone.hot} м · сдвиг каждые {Math.round(zone.every / MIN)} мин. Новая точка
        появляется на карте пунктиром заранее, потом круг плавно переезжает туда.
      </Text>
      {canEdit && (
        <>
          <ZoneSettings zone={zone} onChange={onSet} />
          <Button
            title="Новая раскладка с этого момента"
            icon="dice-multiple-outline"
            kind="secondary"
            onPress={() => onSet(newZone(zone.r, zone.hot, Math.round(zone.every / MIN)))}
          />
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
    borderColor: 'rgba(255, 90, 31, 0.4)',
    backgroundColor: 'rgba(255, 90, 31, 0.07)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  count: { color: HOT, fontFamily: F.mono, fontSize: 34 },
  line: { color: C.text, fontFamily: F.semibold, fontSize: 15 },
  sub: { color: C.dim, fontFamily: F.regular, fontSize: 13, marginTop: 2 },
  me: { color: C.text, fontFamily: F.semibold, fontSize: 15 },
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
});

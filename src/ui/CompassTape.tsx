import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Glass } from './components';
import { C, F, R } from './theme';

const POINTS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
/** Degrees visible across the tape. */
const SPAN = 110;

function cardinal(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * Heading tape across the top of the map, like a rugged GPS unit: the scale slides
 * under a fixed center mark, with the exact bearing in the middle.
 */
export function CompassTape({ heading }: { heading: number | null }) {
  const [width, setWidth] = useState(0);
  const h = heading ?? 0;
  const pxPerDeg = width / SPAN;
  const ticks: { deg: number; x: number }[] = [];
  if (width > 0) {
    const first = Math.ceil((h - SPAN / 2) / 5) * 5;
    for (let d = first; d <= h + SPAN / 2; d += 5) ticks.push({ deg: d, x: width / 2 + (d - h) * pxPerDeg });
  }
  const readout =
    heading == null ? '—' : `${cardinal(heading)} ${String(Math.round((heading + 360) % 360)).padStart(3, '0')}°`;

  return (
    <Glass radius={R.md} style={styles.wrap}>
      <View style={styles.tape} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} pointerEvents="none">
        {heading != null &&
          ticks.map(({ deg, x }) => {
            const norm = ((deg % 360) + 360) % 360;
            const major = norm % 45 === 0;
            const mid = norm % 15 === 0;
            const label = major ? POINTS[norm / 45] : mid ? String(norm) : null;
            return (
              <View key={deg} style={[styles.tickWrap, { left: x - 15 }]}>
                <View style={[styles.tick, mid && styles.tickMid, major && styles.tickMajor]} />
                {label && (
                  <Text style={[styles.tickLabel, major && styles.tickLabelMajor]} numberOfLines={1}>
                    {label}
                  </Text>
                )}
              </View>
            );
          })}
        <View style={styles.center}>
          <View style={styles.caret} />
        </View>
      </View>
      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.readoutText}>{readout}</Text>
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 40, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
  tape: { flex: 1, overflow: 'hidden' },
  tickWrap: { position: 'absolute', top: 0, width: 30, alignItems: 'center' },
  tick: { width: 1, height: 6, backgroundColor: C.dim },
  tickMid: { height: 10, backgroundColor: C.text },
  tickMajor: { width: 2, height: 12, backgroundColor: C.accent },
  tickLabel: { color: C.dim, fontFamily: F.mono, fontSize: 9, marginTop: 2 },
  tickLabelMajor: { color: C.accent, fontSize: 12, fontFamily: F.bold, marginTop: 1 },
  center: { position: 'absolute', top: 0, bottom: 0, left: '50%', marginLeft: -6, width: 12, alignItems: 'center' },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: C.warn,
  },
  readout: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: C.lineStrong,
    backgroundColor: 'rgba(142, 240, 122, 0.08)',
  },
  readoutText: { color: C.accent, fontFamily: F.mono, fontSize: 15, letterSpacing: 0.5 },
});

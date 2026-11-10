import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatDistance } from '../lib/geo';
import { turnAngle, turnText } from '../lib/heading';

import { Glass, Icon, tap } from './components';
import { C, eyebrow, F, R } from './theme';

/**
 * "Lead me there" in place of the bottom HUD: an arrow that points at the target
 * (relative to where the phone looks, or to the screen when there's no compass),
 * distance and time to go.
 */
export function NavPanel({
  name,
  distance,
  bearing,
  heading,
  mapBearing,
  eta,
  arrived,
  compassPoor,
  compact,
  style,
  onClose,
}: {
  name: string;
  distance: number;
  /** True bearing from me to the target. */
  bearing: number;
  /** Where the phone looks (compass), if known. */
  heading: number | null;
  /** Map rotation, for the arrow when there's no compass. */
  mapBearing: number;
  eta: string;
  arrived: boolean;
  /** The compass isn't calibrated: say so instead of trusting the arrow. */
  compassPoor?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  onClose: () => void;
}) {
  // With a compass the arrow is "turn this way"; without, it points on the map.
  const arrow = heading != null ? turnAngle(heading, bearing) : bearing + mapBearing;
  return (
    <Glass radius={R.lg} style={[styles.panel, compact && styles.panelCompact, arrived && styles.arrived, style]}>
      <View style={[styles.arrowBox, arrived && { backgroundColor: C.accent }]}>
        {arrived ? (
          <Icon name="check-bold" size={34} color={C.accentInk} />
        ) : (
          <View style={{ transform: [{ rotate: `${arrow}deg` }] }}>
            <Icon name="navigation" size={38} color={C.accent} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={eyebrow} numberOfLines={1}>
          {arrived ? 'На месте' : 'Ведёт к'} · {name}
        </Text>
        <Text style={styles.big} numberOfLines={1}>
          {formatDistance(distance)}
          {!arrived && <Text style={styles.eta}> · {eta}</Text>}
        </Text>
        {!arrived && (
          <Text style={styles.sub} numberOfLines={1}>
            {Math.round(bearing)}°
            {compassPoor
              ? ' · откалибруйте компас: восьмёркой'
              : heading != null
                ? ` · ${turnText(heading, bearing)}`
                : ' · стрелка по карте, компаса нет'}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityLabel="Остановить навигацию"
        hitSlop={8}
        style={styles.close}
        onPress={() => {
          tap();
          onClose();
        }}
      >
        <Icon name="close" size={20} />
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  panel: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  panelCompact: { padding: 8, gap: 10 },
  arrived: { borderWidth: 1, borderColor: C.accent },
  arrowBox: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { color: C.text, fontSize: 24, fontFamily: F.mono },
  eta: { color: C.accent, fontSize: 16, fontFamily: F.mono },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.mono },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

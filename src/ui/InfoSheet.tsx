import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Sheet } from './components';
import { C, eyebrow, F, R } from './theme';

export type Stat = { label: string; value: string };

/** Details for a tapped marker or teammate: header, a stats grid and actions. */
export function InfoSheet({
  visible,
  onClose,
  leading,
  title,
  subtitle,
  stats,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  leading: ReactNode;
  title: string;
  subtitle?: string | null;
  stats: Stat[];
  children?: ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.label} style={styles.stat}>
            <Text style={eyebrow}>{s.label}</Text>
            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
          </View>
        ))}
      </View>
      {children}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  subtitle: { color: C.dim, fontSize: 14, fontFamily: F.regular, marginTop: 2 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: C.elevated,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: C.line,
  },
  value: { color: C.text, fontSize: 16, fontFamily: F.mono },
});

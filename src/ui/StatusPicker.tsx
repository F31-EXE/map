import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STATUS_ORDER, STATUSES } from '../lib/status';
import type { MemberStatus } from '../lib/types';

import { Icon, tap } from './components';
import { C, F, R } from './theme';

/** Жив / Убит / АФК segmented control. */
export function StatusPicker({ value, onPick }: { value: MemberStatus; onPick: (s: MemberStatus) => void }) {
  return (
    <View style={styles.row}>
      {STATUS_ORDER.map((st) => {
        const d = STATUSES[st];
        const on = st === value;
        return (
          <Pressable
            key={st}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              if (!on) onPick(st);
            }}
            style={[styles.item, on && { borderColor: d.color, backgroundColor: d.color + '22' }]}
          >
            <Icon name={d.icon} size={18} color={on ? d.color : C.dim} />
            <Text style={[styles.text, on && { color: d.color }]}>{d.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Compact status tag for lists. */
export function StatusTag({ status, offline }: { status: MemberStatus; offline?: boolean }) {
  const d = offline && status === 'alive' ? { title: 'Нет связи', color: C.faint } : STATUSES[status];
  return (
    <View style={[styles.tag, { borderColor: d.color + '88' }]}>
      <Text style={[styles.tagText, { color: d.color }]}>{d.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  item: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
  },
  text: { color: C.dim, fontFamily: F.mono, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  tagText: { fontFamily: F.mono, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
});

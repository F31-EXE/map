import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { C } from './theme';

export function Button({
  title,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? C.danger : C.card;
  const fg = kind === 'primary' ? '#10140f' : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === 'secondary' && styles.secondary,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/** Round floating button used over the map. */
export function Fab({
  label,
  onPress,
  active,
  size = 52,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.fab,
        { width: size, height: size, borderRadius: size / 2 },
        active && { backgroundColor: C.info, borderColor: C.info },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.fabText, active && { color: '#000' }]}>{label}</Text>
    </Pressable>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { borderWidth: 1, borderColor: C.border },
  buttonText: { fontSize: 16, fontWeight: '600' },
  fab: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { color: C.text, fontSize: 22, fontWeight: '600' },
  section: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionTitle: { color: C.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
});

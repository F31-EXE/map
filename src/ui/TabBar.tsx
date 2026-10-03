import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, tap, type IconName } from './components';
import { C, F, R } from './theme';

export type TabMeta = { icon: IconName; label: string; badge?: number };

/**
 * Rugged-tablet style tab bar: bordered buttons with mono captions. Bottom row in
 * portrait; a column on the left in landscape, where height is scarce.
 */
export function TabBar({
  state,
  navigation,
  insets,
  meta,
  vertical,
}: BottomTabBarProps & { meta: Record<string, TabMeta>; vertical: boolean }) {
  const keyboard = useKeyboardVisible();
  if (keyboard && !vertical) return null;
  return (
    <View
      style={[
        styles.bar,
        vertical
          ? [styles.barVertical, { paddingLeft: insets.left + 6, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]
          : { paddingBottom: Math.max(insets.bottom, 6), paddingLeft: insets.left + 8, paddingRight: insets.right + 8 },
      ]}
    >
      {state.routes.map((route, i) => {
        const m = meta[route.name];
        if (!m) return null;
        const focused = state.index === i;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={m.label}
            onPress={() => {
              tap();
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            style={({ pressed }) => [
              styles.tab,
              vertical ? styles.tabVertical : styles.tabHorizontal,
              focused && styles.tabActive,
              pressed && { opacity: 0.75 },
            ]}
          >
            <View>
              <Icon name={m.icon} size={vertical ? 20 : 21} color={focused ? C.accent : C.dim} />
              {!!m.badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{m.badge > 9 ? '9+' : m.badge}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, vertical && styles.labelVertical, focused && { color: C.accent }]} numberOfLines={1}>
              {m.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 6,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.lineStrong,
  },
  barVertical: {
    flexDirection: 'column',
    height: '100%',
    borderTopWidth: 0,
    borderRightWidth: 1,
    borderRightColor: C.lineStrong,
    paddingRight: 6,
    gap: 6,
  },
  tab: {
    height: 52,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabHorizontal: { flex: 1 },
  tabVertical: { width: 64, height: 54 },
  tabActive: {
    borderColor: C.accent,
    backgroundColor: C.accentSoft,
    shadowColor: C.accent,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  label: { color: C.dim, fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  labelVertical: { fontSize: 9, letterSpacing: 0.5 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -12,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: F.bold },
});

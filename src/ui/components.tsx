import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  TextInput,
  ScrollView,
  useWindowDimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { roleFrame, ROLES, type RoleId } from '../lib/roles';

import { C, eyebrow, F, R, shadow } from './theme';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color = C.text }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

export const tap = () => {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
};

/**
 * Frosted panel for anything floating over the map. Real blur on iOS; Android can't
 * blur a WebView cheaply, so it gets a denser tint instead.
 */
export function Glass({
  children,
  style,
  radius = R.lg,
  fill,
  onLayout,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** Solid color instead of frosted glass (e.g. an active toggle). */
  fill?: string;
  onLayout?: ViewProps['onLayout'];
}) {
  return (
    <View style={[{ borderRadius: radius }, shadow, style]} onLayout={onLayout}>
      {fill ? (
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: fill }]} />
      ) : (
        <BlurView
          intensity={40}
          tint="dark"
          style={[StyleSheet.absoluteFill, styles.glassFill, { borderRadius: radius }]}
        />
      )}
      {children}
    </View>
  );
}

export function GlassButton({
  icon,
  onPress,
  active,
  size = 48,
  label,
  activeColor = C.accent,
}: {
  icon: IconName;
  onPress: () => void;
  active?: boolean;
  size?: number;
  label?: string;
  activeColor?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={6}
      accessibilityLabel={label}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.94 : 1 }] })}
    >
      <Glass
        radius={R.lg}
        fill={active ? activeColor : undefined}
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={icon} size={size * 0.46} color={active ? C.accentInk : C.text} />
      </Glass>
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = {
    primary: { bg: C.accent, fg: C.accentInk, border: C.accent },
    secondary: { bg: C.elevated, fg: C.text, border: C.lineStrong },
    danger: { bg: C.dangerSoft, fg: C.danger, border: 'rgba(255,77,77,0.35)' },
    ghost: { bg: 'transparent', fg: C.dim, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={palette.fg} />}
          <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={eyebrow}>{children}</Text>
    </View>
  );
}

export function Avatar({
  name,
  color,
  size = 40,
  dim,
  uri,
}: {
  name: string;
  color: string;
  size?: number;
  dim?: boolean;
  /** Photo (data URI); falls back to initials. */
  uri?: string | null;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1.5,
    borderColor: color,
    opacity: dim ? 0.45 : 1,
  };
  if (uri) return <Image source={{ uri }} style={[frame, { backgroundColor: C.elevated }]} />;
  return (
    <View style={[frame, { backgroundColor: color + '26', alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color, fontFamily: F.bold, fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

/**
 * Role glyph (see src/lib/roles.ts). `framed` draws the full badge with its shield or
 * diamond; without it the glyph alone fills the box (for small pins).
 */
export function RoleIcon({
  role,
  size = 22,
  color = C.text,
  framed,
}: {
  role: RoleId;
  size?: number;
  color?: string;
  framed?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox={framed ? '0 0 24 24' : '4 4 16 16'}>
      {framed && <Path d={roleFrame(role)} fill={color} fillRule="evenodd" />}
      <Path d={ROLES[role].path} fill={color} />
    </Svg>
  );
}

export function Badge({ text, color = C.dim }: { text: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color + '55', backgroundColor: color + '1A' }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

/** Bottom sheet over a dimmed backdrop. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width > 640;
  const scrollRef = useRef<ScrollView>(null);
  const onOffset = useKeepFocusedInputVisible(scrollRef);
  return (
    <Modal visible={visible} supportedOrientations={['portrait', 'landscape']} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior="padding">
        <View
          style={[
            styles.sheet,
            {
              maxHeight: height * 0.9,
              paddingLeft: 20 + insets.left,
              paddingRight: 20 + insets.right,
            },
            wide && styles.sheetWide,
          ]}
        >
          <View style={styles.grabber} />
          {/* Scrolls when the content doesn't fit, e.g. in landscape. */}
          <ScrollView
            ref={scrollRef}
            onScroll={(e) => onOffset(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={32}
            contentContainerStyle={{ gap: 16, paddingBottom: insets.bottom + 20 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  glassFill: {
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'ios' ? C.glass : C.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: R.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 16, fontFamily: F.semibold, letterSpacing: 0.2 },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: C.line,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, borderWidth: 1 },
  badgeText: { fontSize: 11, fontFamily: F.semibold, letterSpacing: 0.6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetWide: { width: 600, alignSelf: 'center' },
  sheet: {
    backgroundColor: C.surface,
    paddingTop: 10,
    gap: 12,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    borderTopWidth: 1,
    borderColor: C.lineStrong,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.lineStrong,
    marginBottom: 4,
  },
});

/**
 * After the keyboard opens, scrolls just enough to bring the focused field above it.
 * Android's ScrollView doesn't do this on its own.
 */
export function useKeepFocusedInputVisible(scroll: RefObject<ScrollView | null>) {
  const offset = useRef(0);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      // Let the keyboard-avoiding layout settle first.
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput();
        input?.measureInWindow((_x, y, _w, h) => {
          const overlap = y + h + 24 - e.endCoordinates.screenY;
          if (overlap > 0) scroll.current?.scrollTo({ y: offset.current + overlap, animated: true });
        });
      }, 80);
    });
    return () => sub.remove();
  }, [scroll]);
  return (y: number) => {
    offset.current = y;
  };
}

/** Screen-level scroll view that stays usable with the keyboard open. */
export function KeyboardScroll({
  children,
  contentContainerStyle,
  headerOffset = 0,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Height of the navigation header above this view. */
  headerOffset?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const onOffset = useKeepFocusedInputVisible(ref);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerOffset}>
      <ScrollView
        ref={ref}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => onOffset(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

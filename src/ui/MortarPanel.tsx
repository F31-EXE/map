import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatDistance } from '../lib/geo';
import { formatMils, MAX_ANGLE, RANGE_CHOICES, type FireSolution, type MortarConfig } from '../lib/mortar';

import { Button, Eyebrow, Glass, Icon, RoleIcon, Sheet, tap, type IconName } from './components';
import { C, eyebrow, F, R } from './theme';

const STEPS = [5, 10, 25];

/** Short fire data for marker cards: "68.5° · 152 м", or why it can't be fired. */
export function fireText(s: FireSolution, range: number): string {
  if (s.reach === 'far') return `дальше ${range} м`;
  if (s.reach === 'close') return `ближе минимума (${MAX_ANGLE}°)`;
  return `прицел ${s.angle}° · ${formatDistance(s.dist)}`;
}

function SmallButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.small, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={16} color={C.text} />
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

/**
 * Mortar calculator in place of the bottom HUD: fire data from the firing position to
 * the crosshair, the spotter's corrections, and where the mortar stands.
 */
export function MortarPanel({
  solution,
  range,
  fixed,
  compact,
  style,
  onCorrect,
  onFixHere,
  onUseGps,
  onSettings,
  onClose,
}: {
  /** Null while there is no firing position (no GPS fix yet). */
  solution: FireSolution | null;
  range: number;
  fixed: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  onCorrect: (longer: number, right: number) => void;
  onFixHere: () => void;
  onUseGps: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(10);
  const s = solution;
  const warn =
    !s ? 'Нет позиции миномёта: ждём GPS или поставьте ОП в перекрестие' : s.reach === 'far'
      ? `Цель дальше ${range} м — не достанет`
      : s.reach === 'close'
        ? `Слишком близко: нужен угол круче ${MAX_ANGLE}°`
        : null;
  return (
    <Glass radius={R.lg} style={[styles.panel, compact && styles.panelCompact, style]}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <RoleIcon role="mortar" size={18} color={C.accentInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Миномёт · {range} м</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {fixed ? 'ОП закреплена на карте' : 'ОП — ваша позиция по GPS'}
            {s?.calibrated ? ' · по пристрелке' : ''}
          </Text>
        </View>
        <Pressable accessibilityLabel="Настройки миномёта" hitSlop={6} style={styles.iconBtn} onPress={onSettings}>
          <Icon name="cog-outline" size={20} />
        </Pressable>
        <Pressable accessibilityLabel="Закрыть калькулятор" hitSlop={6} style={styles.iconBtn} onPress={onClose}>
          <Icon name="close" size={20} />
        </Pressable>
      </View>

      <View style={styles.data}>
        <Datum label="Дальность" value={s ? formatDistance(s.dist) : '—'} bad={s?.reach === 'far'} />
        <Datum label="Азимут" value={s ? `${Math.round(s.bearing)}°` : '—'} sub={s ? formatMils(s.bearing) : undefined} />
        <Datum label="Прицел" value={s?.angle != null ? `${s.angle}°` : '—'} big bad={s?.reach === 'close'} />
        <Datum label="Полёт" value={s?.flight != null ? `${s.flight} с` : '—'} />
      </View>
      {warn && (
        <View style={styles.warn}>
          <Icon name="alert-outline" size={16} color={C.danger} />
          <Text style={styles.warnText}>{warn}</Text>
        </View>
      )}

      {!compact && <Text style={eyebrow}>Поправка от наблюдателя, м</Text>}
      <View style={styles.row}>
        {STEPS.map((n) => (
          <Pressable
            key={n}
            onPress={() => {
              tap();
              setStep(n);
            }}
            style={[styles.step, n === step && styles.stepOn]}
          >
            <Text style={[styles.stepText, n === step && { color: C.accentInk }]}>{n}</Text>
          </Pressable>
        ))}
        <SmallButton icon="arrow-down" label="Ближе" onPress={() => onCorrect(-step, 0)} />
        <SmallButton icon="arrow-up" label="Дальше" onPress={() => onCorrect(step, 0)} />
      </View>
      <View style={styles.row}>
        <SmallButton icon="arrow-left" label="Левее" onPress={() => onCorrect(0, -step)} />
        <SmallButton icon="arrow-right" label="Правее" onPress={() => onCorrect(0, step)} />
        {fixed ? (
          <SmallButton icon="crosshairs-gps" label="ОП по GPS" onPress={onUseGps} />
        ) : (
          <SmallButton icon="map-marker-down" label="ОП сюда" onPress={onFixHere} />
        )}
      </View>
    </Glass>
  );
}

function Datum({ label, value, sub, big, bad }: { label: string; value: string; sub?: string; big?: boolean; bad?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={eyebrow}>{label}</Text>
      <Text style={[styles.value, big && styles.valueBig, bad && { color: C.danger }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub && <Text style={styles.sub}>{sub}</Text>}
    </View>
  );
}

/** Range and test shots ("пристрелка"). */
export function MortarSheet({
  visible,
  config,
  aimDistance,
  onChange,
  onClose,
}: {
  visible: boolean;
  config: MortarConfig;
  /** Firing position → crosshair, to record where a test shot landed. */
  aimDistance: number | null;
  onChange: (c: MortarConfig) => void;
  onClose: () => void;
}) {
  const [angle, setAngle] = useState('');
  const [dist, setDist] = useState('');
  const shots = [...config.table].sort((a, b) => a.dist - b.dist);

  const record = () => {
    const a = Number(angle.replace(',', '.'));
    const d = dist.trim() ? Number(dist.replace(',', '.')) : aimDistance != null ? Math.round(aimDistance) : NaN;
    if (!(a > 0 && a < 90)) return Alert.alert('Угол', 'Укажите угол, под которым стреляли: от 1 до 89°');
    if (!(d > 0)) return Alert.alert('Дальность', 'Укажите, на сколько метров улетело, или наведите перекрестие на место падения');
    onChange({ ...config, table: [...config.table, { angle: a, dist: d }].slice(-20) });
    setAngle('');
    setDist('');
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Миномёт</Text>
      <Eyebrow>Максимальная дальность</Eyebrow>
      <View style={styles.row}>
        {RANGE_CHOICES.map((r) => (
          <Pressable
            key={r}
            onPress={() => {
              tap();
              onChange({ ...config, range: r });
            }}
            style={[styles.step, r === config.range && styles.stepOn]}
          >
            <Text style={[styles.stepText, r === config.range && { color: C.accentInk }]}>{r} м</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sheetSub}>
        Круг этого радиуса видят все в отряде. Пока нет пристрелки, угол считается по формуле: максимум дальности
        на 45°, ближе — круче, до {MAX_ANGLE}°.
      </Text>

      <Eyebrow>Пристрелка</Eyebrow>
      <Text style={styles.sheetSub}>
        Выстрелите под известным углом, наведите перекрестие на место падения и запишите выстрел. С двумя и
        больше выстрелами угол считается по ним: так учитываются сопротивление воздуха и давление газа.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={angle}
          onChangeText={setAngle}
          placeholder="Угол, °"
          placeholderTextColor={C.faint}
          keyboardType="decimal-pad"
          maxLength={5}
          style={[styles.input, { flex: 1 }]}
          selectionColor={C.accent}
        />
        <TextInput
          value={dist}
          onChangeText={setDist}
          placeholder={aimDistance != null ? `${Math.round(aimDistance)} м` : 'Дальность, м'}
          placeholderTextColor={C.faint}
          keyboardType="decimal-pad"
          maxLength={5}
          style={[styles.input, { flex: 1 }]}
          selectionColor={C.accent}
        />
      </View>
      <Button title="Записать выстрел" icon="plus" kind="secondary" onPress={record} />
      {shots.length > 0 && (
        <View style={{ gap: 6 }}>
          {shots.map((p, i) => (
            <View key={`${p.angle}-${p.dist}-${i}`} style={styles.shot}>
              <Text style={styles.shotText}>
                {p.angle}° → {Math.round(p.dist)} м
              </Text>
              <Pressable
                accessibilityLabel="Удалить выстрел"
                hitSlop={8}
                onPress={() => {
                  tap();
                  onChange({ ...config, table: config.table.filter((x) => x !== p) });
                }}
              >
                <Icon name="trash-can-outline" size={18} color={C.dim} />
              </Pressable>
            </View>
          ))}
          {shots.length === 1 && <Text style={styles.sheetSub}>Нужен ещё хотя бы один выстрел на другой дальности.</Text>}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 10 },
  panelCompact: { padding: 10, gap: 7 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.text, fontSize: 15, fontFamily: F.bold },
  sub: { color: C.dim, fontSize: 12, fontFamily: F.mono },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  data: { flexDirection: 'row', gap: 8 },
  value: { color: C.accent, fontSize: 17, fontFamily: F.mono, marginTop: 2 },
  valueBig: { fontSize: 22, color: C.text },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnText: { color: C.danger, fontSize: 13, fontFamily: F.semibold, flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  step: {
    minWidth: 40,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOn: { backgroundColor: C.accent, borderColor: C.accent },
  stepText: { color: C.text, fontFamily: F.mono, fontSize: 13 },
  small: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: R.sm,
    backgroundColor: C.elevated,
  },
  smallText: { color: C.text, fontFamily: F.semibold, fontSize: 13 },
  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.bold },
  sheetSub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  shot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: R.sm,
    backgroundColor: C.elevated,
  },
  shotText: { color: C.text, fontFamily: F.mono, fontSize: 14 },
});

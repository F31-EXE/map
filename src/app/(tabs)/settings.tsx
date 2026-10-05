import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { pickAvatar } from '../../services/avatar';
import { useSession } from '../../state/session';
import { Avatar, Card, Eyebrow, Icon, KeyboardScroll, tap, type IconName } from '../../ui/components';
import { RolePicker } from '../../ui/RolePicker';
import { C, F, R } from '../../ui/theme';

export default function SettingsScreen() {
  const s = useSession();
  const [callsign, setCallsign] = useState(s.callsign);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCallsign(s.callsign), [s.callsign]);
  const callsignDirty = callsign.trim() !== s.callsign;
  const color = s.teamId ? s.teamColor : C.accent;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Ошибка', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = () => {
    const pick = () =>
      run(async () => {
        const uri = await pickAvatar();
        if (uri) await s.setAvatar(uri);
      });
    if (!s.avatar) return pick();
    Alert.alert('Аватар', undefined, [
      { text: 'Выбрать другое фото', onPress: pick },
      { text: 'Удалить фото', style: 'destructive', onPress: () => run(() => s.setAvatar(null)) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <KeyboardScroll contentContainerStyle={styles.content}>
      {/* Profile */}
      <Card style={{ gap: 16 }}>
        <View style={styles.profile}>
          <Pressable onPress={changeAvatar} accessibilityLabel="Сменить аватар">
            <Avatar name={callsign || '?'} color={color} uri={s.avatar} size={64} />
            <View style={[styles.avatarEdit, { backgroundColor: color }]}>
              <Icon name="camera" size={14} color={C.accentInk} />
            </View>
          </Pressable>
          <View style={{ flex: 1, gap: 6 }}>
            <Eyebrow>Позывной</Eyebrow>
            <TextInput
              value={callsign}
              onChangeText={setCallsign}
              placeholder="Например: Гром"
              placeholderTextColor={C.faint}
              maxLength={24}
              style={styles.callsignInput}
              selectionColor={C.accent}
              returnKeyType="done"
              onSubmitEditing={() => callsignDirty && run(() => s.setCallsign(callsign))}
            />
          </View>
          {callsignDirty && (
            <Pressable
              style={styles.saveIcon}
              onPress={() => run(() => s.setCallsign(callsign))}
              accessibilityLabel="Сохранить позывной"
            >
              <Icon name="check" size={22} color={C.accentInk} />
            </Pressable>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Eyebrow>Роль · так вас видят на карте</Eyebrow>
          <RolePicker value={s.role} color={color} onPick={(r) => run(() => s.setRole(r))} />
        </View>
      </Card>

      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <SettingRow
          icon={s.shareLocation ? 'access-point' : 'access-point-off'}
          title="Передавать позицию"
          sub={s.shareLocation ? 'Отряд видит вас на карте' : 'Вы скрыты от отряда'}
          value={s.shareLocation}
          onChange={(v) => run(() => s.setShareLocation(v))}
        />
        <View style={styles.divider} />
        <SettingRow
          icon={s.orderSound ? 'volume-high' : 'volume-off'}
          title="Звук приказов"
          sub={s.orderSound ? 'Вибрация и сигнал' : 'Только вибрация'}
          value={s.orderSound}
          onChange={(v) => run(() => s.setOrderSound(v))}
        />
        <View style={styles.divider} />
        <SettingRow
          icon={s.mesh.enabled ? 'bluetooth-connect' : 'bluetooth-off'}
          title="Связь без интернета"
          sub={
            !s.mesh.available
              ? 'Bluetooth и Wi-Fi Direct между телефонами. Только в Android-приложении'
              : s.mesh.error
                ? `Ошибка: ${s.mesh.error}`
                : s.mesh.enabled
                  ? s.teamId
                    ? `Рядом на связи: ${s.mesh.peers}. Позиции и чат передаются от бойца к бойцу`
                    : 'Включится, когда вы в отряде'
                  : 'Позиции и чат от телефона к телефону, когда нет сети'
          }
          value={s.mesh.enabled}
          disabled={!s.mesh.available}
          onChange={(v) =>
            run(async () => {
              await s.mesh.setEnabled(v);
              // Bluetooth stalls with the screen off; keep it on while the mesh runs.
              if (v && !s.keepAwake) await s.setKeepAwake(true);
            })
          }
        />
        <View style={styles.divider} />
        <SettingRow
          icon={s.keepAwake ? 'cellphone-lock' : 'cellphone-off'}
          title="Не гасить экран"
          sub={
            s.keepAwake
              ? 'Позиция и связь работают всю игру. Расход батареи выше'
              : 'С погасшим экраном позиция и Bluetooth могут остановиться'
          }
          value={s.keepAwake}
          onChange={(v) => run(() => s.setKeepAwake(v))}
        />
        <View style={styles.divider} />
        <SettingRow
          icon="grid"
          title="Сетка координат"
          sub="Квадраты UTM на карте, подписи по краям"
          value={s.showGrid}
          onChange={(v) => run(() => s.setShowGrid(v))}
        />
      </Card>

      <Card style={{ gap: 0, paddingVertical: 6 }}>
        <LinkRow icon="map-plus" title="Карты полигона" sub="Импорт KMZ, KML, GPX, GeoJSON" onPress={() => router.push('/maps')} />
        <View style={styles.divider} />
        <LinkRow icon="history" title="Записи игр" sub="Маршруты и тепловая карта" onPress={() => router.push('/replay')} />
      </Card>

      <Text style={styles.version}>
        GRIMMAP v{Constants.expoConfig?.version ?? '—'}
      </Text>
    </KeyboardScroll>
  );
}

function SettingRow({
  icon,
  title,
  sub,
  value,
  onChange,
  disabled,
}: {
  icon: IconName;
  title: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, value && { backgroundColor: C.accentSoft, borderColor: C.lineStrong }]}>
        <Icon name={icon} size={22} color={value ? C.accent : C.dim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: C.accent, false: C.elevated }}
        thumbColor="#fff"
      />
    </View>
  );
}

function LinkRow({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      onPress={() => {
        tap();
        onPress();
      }}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={22} color={C.dim} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={C.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32, width: '100%', maxWidth: 640, alignSelf: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callsignInput: { color: C.text, fontSize: 22, fontFamily: F.bold, padding: 0 },
  saveIcon: {
    width: 40,
    height: 40,
    borderRadius: R.md,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  version: { color: C.faint, fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, textAlign: 'center' },
});

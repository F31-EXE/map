import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { STALE_MS } from '../map/TacticalMap';
import { useSession } from '../state/session';
import { Avatar, Badge, Button, Card, Eyebrow, Icon } from '../ui/components';
import { C, F, R } from '../ui/theme';

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Ошибка', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export default function TeamScreen() {
  const s = useSession();
  const { busy, run } = useAction();
  const [callsign, setCallsign] = useState(s.callsign);
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [copied, setCopied] = useState(false);

  useEffect(() => setCallsign(s.callsign), [s.callsign]);

  const inTeam = Boolean(s.teamId && s.uid);
  const isOwner = s.team?.ownerId === s.uid;
  const callsignDirty = callsign.trim() !== s.callsign;
  const now = Date.now();

  const sortedMembers = [...s.members].sort((a, b) => {
    if (a.id === s.uid) return -1;
    if (b.id === s.uid) return 1;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Callsign */}
      <Card style={styles.profile}>
        <Avatar name={callsign || '?'} color={C.accent} size={56} />
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
            onSubmitEditing={() => callsignDirty && run('cs', () => s.setCallsign(callsign))}
          />
        </View>
        {callsignDirty && (
          <Pressable
            style={styles.saveIcon}
            onPress={() => run('cs', () => s.setCallsign(callsign))}
            accessibilityLabel="Сохранить позывной"
          >
            <Icon name="check" size={22} color={C.accentInk} />
          </Pressable>
        )}
      </Card>

      {!s.firebaseEnabled ? (
        <Card>
          <View style={styles.inlineTitle}>
            <Icon name="cloud-off-outline" size={22} color={C.warn} />
            <Text style={styles.cardTitle}>Сервер не настроен</Text>
          </View>
          <Text style={styles.text}>
            Карта, импорт карт полигона и личные метки работают и без сервера. Чтобы видеть товарищей,
            заполните настройки Firebase в файле .env (см. README).
          </Text>
        </Card>
      ) : !s.uid ? (
        <Card>
          <Text style={styles.text}>{s.authError ?? 'Подключаемся к серверу…'}</Text>
        </Card>
      ) : !inTeam ? (
        <Card style={{ gap: 16 }}>
          <View style={styles.segment}>
            {(['join', 'create'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.segmentItem, mode === m && styles.segmentActive]}>
                <Text style={[styles.segmentText, mode === m && { color: C.accentInk }]}>
                  {m === 'join' ? 'Вступить' : 'Создать'}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === 'join' ? (
            <>
              <Text style={styles.text}>Введите код, который вам продиктовал командир.</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="K7QX2M"
                placeholderTextColor={C.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                style={styles.codeInput}
                selectionColor={C.accent}
              />
              <Button
                title="Вступить в команду"
                icon="login"
                disabled={code.length < 6}
                busy={busy === 'join'}
                onPress={() => run('join', () => s.joinTeam(code))}
              />
            </>
          ) : (
            <>
              <Text style={styles.text}>Вы станете командиром и получите код для товарищей.</Text>
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="Название, например «Отряд Север»"
                placeholderTextColor={C.faint}
                maxLength={40}
                style={styles.input}
                selectionColor={C.accent}
              />
              <Button
                title="Создать команду"
                icon="flag-plus"
                busy={busy === 'create'}
                onPress={() => run('create', () => s.createTeam(teamName))}
              />
            </>
          )}
        </Card>
      ) : (
        <>
          {/* Team + invite code */}
          <Card style={{ gap: 14 }}>
            <View style={styles.teamHeader}>
              <View style={{ flex: 1 }}>
                <Eyebrow>Команда</Eyebrow>
                <Text style={styles.teamName} numberOfLines={1}>
                  {s.team?.name ?? '…'}
                </Text>
              </View>
              {isOwner && <Badge text="КОМАНДИР" color={C.accent} />}
            </View>
            <View style={styles.codeRow}>
              {(s.team?.code ?? '······').split('').map((ch, i) => (
                <View key={i} style={styles.codeCell}>
                  <Text style={styles.codeChar}>{ch}</Text>
                </View>
              ))}
            </View>
            <View style={styles.row}>
              <Button
                title={copied ? 'Скопировано' : 'Копировать'}
                icon={copied ? 'check' : 'content-copy'}
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  if (!s.team) return;
                  Clipboard.setStringAsync(s.team.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
              <Button
                title="Пригласить"
                icon="share-variant"
                style={{ flex: 1 }}
                onPress={() =>
                  s.team &&
                  Share.share({ message: `Вступай в команду «${s.team.name}» в TacMap. Код: ${s.team.code}` })
                }
              />
            </View>
            {s.teamError && <Text style={styles.error}>{s.teamError}</Text>}
          </Card>

          {/* Location sharing */}
          <Card style={styles.switchCard}>
            <View style={[styles.switchIcon, s.shareLocation && { backgroundColor: C.accentSoft }]}>
              <Icon name={s.shareLocation ? 'access-point' : 'access-point-off'} size={22} color={s.shareLocation ? C.accent : C.dim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Передавать позицию</Text>
              <Text style={styles.sub}>{s.shareLocation ? 'Команда видит вас на карте' : 'Вы скрыты от команды'}</Text>
            </View>
            <Switch
              value={s.shareLocation}
              onValueChange={(v) => run('share', () => s.setShareLocation(v))}
              trackColor={{ true: C.accent, false: C.elevated }}
              thumbColor="#fff"
            />
          </Card>

          {/* Roster */}
          <View style={{ gap: 10 }}>
            <Eyebrow style={{ paddingHorizontal: 4 }}>Состав · {s.members.length}</Eyebrow>
            <Card style={{ gap: 0, paddingVertical: 6 }}>
              {sortedMembers.map((m, i) => {
                const fresh = m.lat != null && m.updatedAt != null && now - m.updatedAt < STALE_MS;
                const me = m.id === s.uid;
                return (
                  <View key={m.id} style={[styles.member, i > 0 && styles.memberBorder]}>
                    <View>
                      <Avatar name={m.callsign} color={m.color} size={42} dim={!fresh} />
                      <View style={[styles.presence, { backgroundColor: fresh ? C.online : C.faint }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {m.callsign}
                        </Text>
                        {me && <Badge text="Я" />}
                        {m.id === s.team?.ownerId && <Icon name="star-four-points" size={14} color={C.accent} />}
                      </View>
                      <Text style={styles.sub}>
                        {m.lat == null
                          ? 'Позиция скрыта'
                          : m.updatedAt
                            ? `${fresh ? 'На связи' : 'Был'} ${timeAgo(m.updatedAt)}`
                            : '—'}
                      </Text>
                    </View>
                    {isOwner && !me && (
                      <Pressable
                        hitSlop={8}
                        style={styles.kick}
                        onPress={() =>
                          Alert.alert('Исключить из команды?', m.callsign, [
                            { text: 'Отмена', style: 'cancel' },
                            { text: 'Исключить', style: 'destructive', onPress: () => run('kick', () => s.kickMember(m.id)) },
                          ])
                        }
                      >
                        <Icon name="account-remove-outline" size={20} color={C.dim} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </Card>
          </View>

          <Button
            title="Покинуть команду"
            kind="danger"
            icon="logout"
            busy={busy === 'leave'}
            onPress={() =>
              Alert.alert('Покинуть команду?', 'Вернуться можно по коду.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Покинуть', style: 'destructive', onPress: () => run('leave', s.leaveTeam) },
              ])
            }
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  callsignInput: { color: C.text, fontSize: 22, fontFamily: F.bold, padding: 0 },
  saveIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: C.text, fontSize: 16, fontFamily: F.semibold },
  text: { color: C.dim, fontSize: 15, lineHeight: 21, fontFamily: F.regular },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, marginTop: 1 },
  error: { color: C.danger, fontSize: 14, fontFamily: F.regular },
  input: {
    backgroundColor: C.elevated,
    color: C.text,
    borderRadius: R.md,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 16,
    fontFamily: F.regular,
  },
  codeInput: {
    backgroundColor: C.elevated,
    color: C.accent,
    borderRadius: R.md,
    height: 64,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 30,
    fontFamily: F.mono,
    letterSpacing: 10,
    textAlign: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: C.elevated,
    borderRadius: R.md,
    padding: 4,
  },
  segmentItem: { flex: 1, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.dim, fontSize: 15, fontFamily: F.semibold },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamName: { color: C.text, fontSize: 24, fontFamily: F.bold, marginTop: 2 },
  codeRow: { flexDirection: 'row', gap: 6 },
  codeCell: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: R.sm,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.accent + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { color: C.accent, fontSize: 28, fontFamily: F.mono },
  row: { flexDirection: 'row', gap: 10 },
  switchCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  presence: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.surface,
  },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberName: { color: C.text, fontSize: 16, fontFamily: F.semibold, flexShrink: 1 },
  kick: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

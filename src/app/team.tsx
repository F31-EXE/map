import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { timeAgo } from '../lib/geo';
import { STALE_MS } from '../map/TacticalMap';
import { useSession } from '../state/session';
import { Button, Section } from '../ui/components';
import { C } from '../ui/theme';

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

  useEffect(() => setCallsign(s.callsign), [s.callsign]);

  const inTeam = Boolean(s.teamId && s.uid);
  const isOwner = s.team?.ownerId === s.uid;
  const callsignDirty = callsign.trim() !== s.callsign;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Section title="Позывной">
        <TextInput
          value={callsign}
          onChangeText={setCallsign}
          placeholder="Например: Гром"
          placeholderTextColor={C.muted}
          maxLength={24}
          style={styles.input}
        />
        {callsignDirty && (
          <Button title="Сохранить" busy={busy === 'cs'} onPress={() => run('cs', () => s.setCallsign(callsign))} />
        )}
      </Section>

      {!s.firebaseEnabled ? (
        <Section title="Команды недоступны">
          <Text style={styles.text}>
            Сервер не настроен. Карта, импорт карт полигона и личные метки работают и так. Чтобы видеть
            товарищей, заполните настройки Firebase в файле .env (см. README).
          </Text>
        </Section>
      ) : !s.uid ? (
        <Section title="Подключение">
          <Text style={styles.text}>{s.authError ?? 'Подключаемся к серверу…'}</Text>
        </Section>
      ) : !inTeam ? (
        <>
          <Section title="Вступить в команду">
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="Код команды, например K7QX2M"
              placeholderTextColor={C.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              style={[styles.input, styles.codeInput]}
            />
            <Button
              title="Вступить"
              disabled={code.trim().length < 4}
              busy={busy === 'join'}
              onPress={() => run('join', () => s.joinTeam(code))}
            />
          </Section>
          <Section title="Создать команду">
            <TextInput
              value={teamName}
              onChangeText={setTeamName}
              placeholder="Название, например «Отряд Север»"
              placeholderTextColor={C.muted}
              maxLength={40}
              style={styles.input}
            />
            <Button
              title="Создать"
              kind="secondary"
              busy={busy === 'create'}
              onPress={() => run('create', () => s.createTeam(teamName))}
            />
          </Section>
        </>
      ) : (
        <>
          <Section title={s.team?.name ?? 'Команда'}>
            <Text style={styles.text}>Код для вступления — продиктуйте или отправьте товарищам:</Text>
            <Text style={styles.code} selectable>
              {s.team?.code ?? '……'}
            </Text>
            <View style={styles.row}>
              <Button
                title="Копировать"
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() => s.team && Clipboard.setStringAsync(s.team.code)}
              />
              <Button
                title="Отправить"
                kind="secondary"
                style={{ flex: 1 }}
                onPress={() =>
                  s.team &&
                  Share.share({ message: `Вступай в команду «${s.team.name}» в TacMap. Код: ${s.team.code}` })
                }
              />
            </View>
            {s.teamError && <Text style={styles.error}>{s.teamError}</Text>}
          </Section>

          <Section title="Моя позиция">
            <View style={styles.switchRow}>
              <Text style={[styles.text, { flex: 1 }]}>Показывать меня команде</Text>
              <Switch
                value={s.shareLocation}
                onValueChange={(v) => run('share', () => s.setShareLocation(v))}
                trackColor={{ true: C.accent }}
              />
            </View>
          </Section>

          <Section title={`Состав (${s.members.length})`}>
            {s.members.map((m) => {
              const fresh = m.updatedAt != null && Date.now() - m.updatedAt < STALE_MS && m.lat != null;
              const me = m.id === s.uid;
              return (
                <View key={m.id} style={styles.member}>
                  <View style={[styles.memberDot, { backgroundColor: m.color, opacity: fresh ? 1 : 0.35 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>
                      {m.callsign}
                      {me ? ' (я)' : ''}
                      {m.id === s.team?.ownerId ? ' ★' : ''}
                    </Text>
                    <Text style={styles.memberSub}>
                      {m.lat == null ? 'позиция скрыта' : m.updatedAt ? timeAgo(m.updatedAt) : '—'}
                    </Text>
                  </View>
                  {isOwner && !me && (
                    <Button
                      title="Исключить"
                      kind="secondary"
                      onPress={() =>
                        Alert.alert('Исключить?', m.callsign, [
                          { text: 'Отмена', style: 'cancel' },
                          {
                            text: 'Исключить',
                            style: 'destructive',
                            onPress: () => run('kick', () => s.kickMember(m.id)),
                          },
                        ])
                      }
                    />
                  )}
                </View>
              );
            })}
          </Section>

          <Button
            title="Покинуть команду"
            kind="danger"
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
  input: {
    backgroundColor: C.bg,
    color: C.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 16,
  },
  codeInput: { letterSpacing: 4, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  text: { color: C.text, fontSize: 15, lineHeight: 21 },
  error: { color: C.danger, fontSize: 14 },
  code: { color: C.accent, fontSize: 36, fontWeight: '800', letterSpacing: 6, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  memberDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  memberName: { color: C.text, fontSize: 16, fontWeight: '600' },
  memberSub: { color: C.muted, fontSize: 13 },
});

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { bearingDegrees, distanceMeters, formatClock, formatDistance } from '../lib/geo';
import { MARKER_KINDS } from '../lib/markerKinds';
import type { Briefing, TacMarker } from '../lib/types';
import * as teams from '../services/teams';
import { useOverlays } from '../state/overlays';
import { useSession } from '../state/session';
import { Button, Card, Eyebrow, Icon, KeyboardScroll, tap } from '../ui/components';
import { C, F, R } from '../ui/theme';

/** Kinds that make sense as briefing points (not game objects or photos). */
const pointable = (m: TacMarker) => Boolean(m.teamId) && !['hotzone', 'flag', 'ball', 'sector', 'photo'].includes(m.kind);

const pointTitle = (m: TacMarker) => m.label || MARKER_KINDS[m.kind].title;

/** What tells same-looking points apart: kind (when captioned), author, time, where from me. */
function pointInfo(m: TacMarker, me: { lat: number; lng: number } | null): string {
  const parts = [
    m.label ? MARKER_KINDS[m.kind].title : null,
    m.createdByName || null,
    m.createdAt ? formatClock(m.createdAt) : null,
    me ? `${formatDistance(distanceMeters(me, m))}, азимут ${Math.round(bearingDegrees(me, m))}°` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** A point's caption, edited in place (squad markers: the author or a commander). */
function Caption({ m, onDone }: { m: TacMarker; onDone: () => void }) {
  const s = useSession();
  const [text, setText] = useState(m.label);
  const save = () => {
    if (text.trim() !== m.label) s.renameMarker(m, text).catch((e: Error) => Alert.alert('Не сохранилось', e.message));
    onDone();
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      autoFocus
      placeholder={MARKER_KINDS[m.kind].title}
      placeholderTextColor={C.faint}
      maxLength={40}
      returnKeyType="done"
      onSubmitEditing={save}
      onBlur={save}
      style={[styles.input, styles.captionInput]}
    />
  );
}

/**
 * Squad briefing: the commander writes the task, a time and the points that matter;
 * fighters read it and press «Прочитал», the commander sees who hasn't.
 */
export default function BriefingScreen() {
  const s = useSession();
  const { requestView } = useOverlays();
  const brief = s.team?.briefing ?? null;
  const [editing, setEditing] = useState(false);

  if (!s.teamId || !s.uid) {
    return (
      <View style={styles.empty}>
        <Text style={styles.dim}>Брифинг бывает только в отряде.</Text>
      </View>
    );
  }
  // No briefing yet: a commander goes straight to writing one (also when the squad
  // loads after the screen opened).
  if (editing || (!brief && s.canCommand)) return <Editor brief={brief} onDone={() => setEditing(false)} />;
  if (!brief) {
    return (
      <View style={styles.empty}>
        <Icon name="clipboard-text-outline" size={44} color={C.faint} />
        <Text style={styles.dim}>Командир ещё не написал брифинг.</Text>
      </View>
    );
  }

  const points = brief.points
    .map((id) => s.markers.find((m) => m.id === id))
    .filter((m): m is TacMarker => Boolean(m));
  const read = s.members.filter((m) => m.briefRead === brief.at);
  const unread = s.members.filter((m) => m.briefRead !== brief.at && m.id !== brief.by);
  const mine = s.members.find((m) => m.id === s.uid);
  const iRead = brief.by === s.uid || mine?.briefRead === brief.at;

  const me = s.getLastFix();
  const show = (m: TacMarker) => {
    tap();
    requestView({ lat: m.lat, lng: m.lng, zoom: 17, markerId: m.id });
    router.navigate('/');
  };

  return (
    <KeyboardScroll contentContainerStyle={styles.scroll}>
      <Card style={{ gap: 12 }}>
        <View style={styles.head}>
          <Icon name="clipboard-text-outline" size={22} color={C.accent} />
          <Text style={styles.title} numberOfLines={1}>
            Брифинг{brief.time ? ` · ${brief.time}` : ''}
          </Text>
        </View>
        <Text style={styles.text} selectable>
          {brief.text}
        </Text>
        <Text style={styles.by}>
          {brief.byName || 'Командир'} · {new Date(brief.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Card>

      {points.length > 0 && (
        <View style={{ gap: 8 }}>
          <Eyebrow style={{ paddingHorizontal: 4 }}>Точки · нажмите, чтобы показать на карте</Eyebrow>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {points.map((m, i) => (
              <Pressable key={m.id} onPress={() => show(m)} style={({ pressed }) => [styles.point, i > 0 && styles.sep, pressed && { opacity: 0.6 }]}>
                <Icon name={MARKER_KINDS[m.kind].icon} size={20} color={m.color ?? MARKER_KINDS[m.kind].color} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointText} numberOfLines={1}>
                    {pointTitle(m)}
                  </Text>
                  <Text style={styles.pointInfo} numberOfLines={1}>
                    {pointInfo(m, me)}
                  </Text>
                </View>
                <Icon name="map-search-outline" size={18} color={C.faint} />
              </Pressable>
            ))}
          </Card>
        </View>
      )}

      {iRead ? (
        <Text style={styles.done}>
          <Icon name="check-circle" size={16} color={C.accent} /> {brief.by === s.uid ? 'Вы автор брифинга' : 'Вы прочитали брифинг'}
        </Text>
      ) : (
        <Button
          title="Прочитал"
          icon="check"
          onPress={() => teams.markBriefingRead(s.teamId!, s.uid!, brief.at).catch((e: Error) => Alert.alert('Не сохранилось', e.message))}
        />
      )}

      {s.canCommand && (
        <>
          <Card style={{ gap: 8 }}>
            <Eyebrow>
              Прочитали {read.length} из {read.length + unread.length}
            </Eyebrow>
            {unread.length > 0 ? (
              <Text style={styles.unread}>Не прочитали: {unread.map((m) => m.callsign).join(', ')}</Text>
            ) : (
              <Text style={styles.dim}>Прочитали все</Text>
            )}
          </Card>
          <View style={styles.row}>
            <Button title="Изменить" icon="pencil" kind="secondary" style={{ flex: 1 }} onPress={() => setEditing(true)} />
            <Button
              title="Убрать"
              icon="delete-outline"
              kind="danger"
              style={{ flex: 1 }}
              onPress={() =>
                Alert.alert('Убрать брифинг?', 'Отряд перестанет его видеть', [
                  { text: 'Отмена', style: 'cancel' },
                  {
                    text: 'Убрать',
                    style: 'destructive',
                    onPress: () => teams.setBriefing(s.teamId!, null).catch((e: Error) => Alert.alert('Ошибка', e.message)),
                  },
                ])
              }
            />
          </View>
        </>
      )}
    </KeyboardScroll>
  );
}

function Editor({ brief, onDone }: { brief: Briefing | null; onDone: () => void }) {
  const s = useSession();
  const [text, setText] = useState(brief?.text ?? '');
  const [time, setTime] = useState(brief?.time ?? '');
  const [points, setPoints] = useState<string[]>(brief?.points ?? []);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const me = s.getLastFix();
  const candidates = useMemo(
    () => s.markers.filter(pointable).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60),
    [s.markers]
  );

  const save = async () => {
    if (!text.trim()) {
      Alert.alert('Пустой брифинг', 'Напишите задачу');
      return;
    }
    setBusy(true);
    try {
      await teams.setBriefing(s.teamId!, {
        text: text.trim().slice(0, 2000),
        time: time.trim().slice(0, 20) || null,
        points: points.slice(0, 30),
        by: s.uid!,
        byName: (s.callsign || 'Командир').slice(0, 24),
        at: Date.now(),
      });
      onDone();
    } catch (e) {
      Alert.alert('Не сохранилось', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScroll contentContainerStyle={styles.scroll}>
      <Card style={{ gap: 10 }}>
        <Eyebrow>Задача</Eyebrow>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Например: заходим с севера двумя группами, держим мост до сигнала"
          placeholderTextColor={C.faint}
          multiline
          maxLength={2000}
          style={[styles.input, { minHeight: 120 }]}
        />
        <Eyebrow>Время</Eyebrow>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="10:30 или «после второго свистка»"
          placeholderTextColor={C.faint}
          maxLength={20}
          style={styles.input}
        />
      </Card>

      <View style={{ gap: 8 }}>
        <Eyebrow style={{ paddingHorizontal: 4 }}>Точки на карте · {points.length ? `выбрано ${points.length}` : 'необязательно'}</Eyebrow>
        <Text style={[styles.dim, { paddingHorizontal: 4, textAlign: 'left' }]}>
          Карандаш — подписать точку («Вход Д2», «Сбор»): подпись увидят все на карте и в брифинге.
        </Text>
        {candidates.length === 0 ? (
          <Text style={[styles.dim, { paddingHorizontal: 4 }]}>Поставьте метки отряда на карте — их можно будет добавить сюда.</Text>
        ) : (
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {candidates.map((m, i) => {
              const on = points.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    tap();
                    setPoints((p) => (on ? p.filter((x) => x !== m.id) : p.length < 30 ? [...p, m.id] : p));
                  }}
                  style={[styles.point, i > 0 && styles.sep]}
                >
                  <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? C.accent : C.faint} />
                  <Icon name={MARKER_KINDS[m.kind].icon} size={18} color={m.color ?? MARKER_KINDS[m.kind].color} />
                  {renaming === m.id ? (
                    <Caption m={m} onDone={() => setRenaming(null)} />
                  ) : (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pointText, !m.label && { color: C.dim }]} numberOfLines={1}>
                        {pointTitle(m)}
                      </Text>
                      <Text style={styles.pointInfo} numberOfLines={1}>
                        {pointInfo(m, me)}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    hitSlop={10}
                    onPress={() => {
                      tap();
                      setRenaming(m.id);
                    }}
                    accessibilityLabel="Подписать метку"
                  >
                    <Icon name="pencil-outline" size={18} color={C.faint} />
                  </Pressable>
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>

      <Text style={styles.dim}>После сохранения бойцы снова отметят «Прочитал».</Text>
      <View style={styles.row}>
        {brief && <Button title="Отмена" kind="secondary" style={{ flex: 1 }} onPress={onDone} />}
        <Button title="Сохранить" icon="check" busy={busy} style={{ flex: 1 }} onPress={save} />
      </View>
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 18, fontFamily: F.bold, flex: 1 },
  text: { color: C.text, fontSize: 16, fontFamily: F.regular, lineHeight: 23 },
  by: { color: C.faint, fontSize: 12, fontFamily: F.mono },
  dim: { color: C.dim, fontSize: 14, fontFamily: F.regular, textAlign: 'center' },
  unread: { color: C.warn, fontSize: 14, fontFamily: F.regular },
  done: { color: C.accent, fontSize: 14, fontFamily: F.semibold, textAlign: 'center', paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 10 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  pointText: { color: C.text, fontSize: 15, fontFamily: F.regular },
  pointInfo: { color: C.faint, fontSize: 12, fontFamily: F.mono, marginTop: 2 },
  captionInput: { flex: 1, paddingVertical: 6 },
  input: {
    color: C.text,
    fontSize: 15,
    fontFamily: F.regular,
    backgroundColor: C.elevated,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    padding: 12,
    textAlignVertical: 'top',
  },
});

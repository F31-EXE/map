import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MAX_FACTIONS, validFaction } from '../lib/game';
import type { Member } from '../lib/types';
import type { GameState } from '../state/session';

import { Card, Eyebrow, Icon, tap } from './components';
import { C, F, R } from './theme';

/** Team scores as colored pills: every team for the game master, one's own for a player. */
export function ScoreRow({ game, compact }: { game: GameState; compact?: boolean }) {
  if (!game.on || !game.zoneId) return null;
  const shown = game.isMaster
    ? game.factions.map((f, i) => ({ f, i }))
    : game.myFaction != null
      ? [{ f: game.factions[game.myFaction], i: game.myFaction }]
      : [];
  if (!shown.length) return null;
  return (
    <View style={[styles.scores, compact && { gap: 6 }]}>
      {shown.map(({ f, i }) => (
        <View key={i} style={[styles.score, compact && styles.scoreCompact, { borderColor: f.color + '88' }]}>
          <View style={[styles.dot, { backgroundColor: f.color }]} />
          {!compact && <Text style={styles.scoreName}>{f.name}</Text>}
          <Text style={[styles.scoreValue, compact && { fontSize: 12 }]}>{game.scores[i] ?? 0}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Team game setup (game master) or the player's team and score. Scoring itself needs a
 * control zone on the map ("+" → "Режим игры").
 */
export function GameCard({
  game,
  members,
  onCount,
}: {
  game: GameState;
  members: Member[];
  onCount: (n: number) => void;
}) {
  if (!game.isMaster && !game.on) return null;
  if (!game.isMaster) {
    const f = game.myFaction != null ? game.factions[game.myFaction] : null;
    return (
      <Card style={{ gap: 10 }}>
        <View style={styles.head}>
          <Icon name="trophy-outline" size={20} color={f?.color ?? C.dim} />
          <Text style={styles.title}>{f ? `Вы в команде «${f.name}»` : 'Игра по командам'}</Text>
        </View>
        <Text style={styles.sub}>
          {f
            ? 'На карте видны только бойцы вашей команды. Каждую минуту в зоне контроля — 1 очко, в хотзоне — 2.'
            : 'Игротех ещё не назначил вам команду. Пока вы видите только его метки.'}
        </Text>
        <ScoreRow game={game} />
      </Card>
    );
  }
  const counts = game.factions.map((_, i) => members.filter((m) => m.faction === i).length);
  const unassigned = members.filter((m) => !validFaction(m.faction, game.factions.length)).length;
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <Icon name="trophy-outline" size={20} color={game.on ? C.accent : C.dim} />
        <Text style={styles.title}>Игра по командам</Text>
      </View>
      <Text style={styles.sub}>
        Вы — игротех: видите всех и общий счёт. Игроки видят только свою команду и её счёт. Очки идут в зоне контроля
        (+ → «Режим игры»): 1 в минуту за бойца в зоне, 2 — в хотзоне.
      </Text>
      <Eyebrow>Команд</Eyebrow>
      <View style={styles.chips}>
        {[0, ...Array.from({ length: MAX_FACTIONS }, (_, i) => i + 1)].map((n) => {
          const on = n === game.factions.length;
          return (
            <Pressable
              key={n}
              onPress={() => {
                tap();
                onCount(n);
              }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && { color: C.accentInk }]}>{n === 0 ? 'Выкл' : n}</Text>
            </Pressable>
          );
        })}
      </View>
      {game.on && (
        <>
          <View style={{ gap: 6 }}>
            {game.factions.map((f, i) => (
              <View key={i} style={styles.factionRow}>
                <View style={[styles.dot, { backgroundColor: f.color }]} />
                <Text style={styles.factionName}>{f.name}</Text>
                <Text style={styles.sub}>{counts[i]} чел.</Text>
                {game.zoneId && <Text style={styles.factionScore}>{game.scores[i] ?? 0}</Text>}
              </View>
            ))}
          </View>
          <Text style={styles.sub}>
            {unassigned
              ? `Без команды: ${unassigned}. Нажмите на бойца в составе, чтобы назначить команду.`
              : 'Все бойцы распределены. Команду можно сменить в карточке бойца.'}
          </Text>
        </>
      )}
    </Card>
  );
}

/** Game master's team picker in a fighter's card. */
export function FactionPicker({
  game,
  value,
  onPick,
}: {
  game: GameState;
  value: number | null | undefined;
  onPick: (f: number | null) => void;
}) {
  const current = validFaction(value, game.factions.length) ? value : null;
  return (
    <View style={styles.chips}>
      {[null, ...game.factions.map((_, i) => i)].map((i) => {
        const f = i == null ? null : game.factions[i];
        const on = i === current;
        return (
          <Pressable
            key={String(i)}
            onPress={() => {
              tap();
              onPick(i);
            }}
            style={[styles.chip, on && { backgroundColor: f?.color ?? C.lineStrong, borderColor: f?.color ?? C.lineStrong }]}
          >
            {f && !on && <View style={[styles.dot, { backgroundColor: f.color }]} />}
            <Text style={[styles.chipText, on && { color: C.accentInk }]}>{f ? f.name : 'Нет'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: C.text, fontSize: 16, fontFamily: F.semibold, flex: 1 },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontFamily: F.semibold, fontSize: 13 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  factionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factionName: { color: C.text, fontFamily: F.semibold, fontSize: 14, flex: 1 },
  factionScore: { color: C.text, fontFamily: F.mono, fontSize: 16, minWidth: 40, textAlign: 'right' },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: R.pill,
    borderWidth: 1,
    backgroundColor: C.elevated,
  },
  scoreCompact: { height: 22, paddingHorizontal: 7, gap: 4 },
  scoreName: { color: C.dim, fontFamily: F.semibold, fontSize: 12 },
  scoreValue: { color: C.text, fontFamily: F.mono, fontSize: 14 },
});

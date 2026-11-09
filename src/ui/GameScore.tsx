import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { matchState, type MatchState } from '../lib/gameModes';
import type { Game } from '../lib/types';
import { formatCountdown } from '../lib/waves';
import { useGame } from '../state/game';

import { Icon } from './components';
import { C, F, R } from './theme';

/** The match clock, ticking every second. */
export function useMatch(game: Game | null): MatchState {
  const [now, setNow] = useState(Date.now());
  const running = Boolean(game?.match);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return matchState(game?.match, now);
}

export function matchText(st: MatchState): string {
  if (st.phase === 'running') return `до конца ${formatCountdown(st.left)}`;
  if (st.phase === 'over') return 'матч окончен';
  return 'матч не начат';
}

/**
 * Score of each side in the modes that are on. Players see their own side; game techs
 * see every side. `compact`: one line per side for the map.
 */
export function GameScore({ compact }: { compact?: boolean }) {
  const g = useGame();
  const st = useMatch(g.game);
  if (!g.game) return null;
  const shown = g.isTech ? g.sides : g.sides.filter((s) => s.id === g.mySideId);
  const sc = g.scores;
  const hasSectors = Object.keys(sc.sectors).length > 0 || g.markers.some((m) => m.kind === 'sector');
  const hasFlags = g.markers.some((m) => m.kind === 'flag');
  const hasBalls = Object.keys(sc.balls).length > 0;
  return (
    <View style={{ gap: compact ? 4 : 8 }}>
      {g.game.match && (
        <View style={styles.row}>
          <Icon name="timer-outline" size={compact ? 14 : 18} color={st.phase === 'running' ? C.accent : C.dim} />
          <Text style={[styles.clock, compact && { fontSize: 12 }]}>{matchText(st)}</Text>
        </View>
      )}
      {sc.winners.length > 0 && (
        <Text style={[styles.win, compact && { fontSize: 12 }]}>
          {sc.winners.length > 1
            ? 'Ничья'
            : `${sc.goal ? 'Гол! ' : ''}Победа: ${g.sideName(sc.winners[0])}`}
        </Text>
      )}
      {shown.map((s) => {
        const parts = [
          sc.tickets ? `тикеты ${Math.max(0, sc.tickets[s.id] ?? 0)}` : null,
          hasSectors ? `территории ${sc.sectors[s.id] ?? 0}/9` : null,
          hasFlags ? `флаги ${sc.flags[s.id] ?? 0} · ${sc.flagMinutes[s.id] ?? 0} мин` : null,
          sc.zoneId ? `зона ${sc.zone[s.id] ?? 0}` : null,
          hasBalls && s.id in sc.balls ? `мяч ${Math.round(sc.balls[s.id] * 100)} %` : null,
        ].filter(Boolean);
        return (
          <View key={s.id} style={[styles.row, !compact && styles.side, !compact && { borderColor: s.color + '88' }]}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={[styles.name, compact && { fontSize: 12 }]} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={[styles.value, compact && { fontSize: 11 }]} numberOfLines={compact ? 1 : 2}>
              {parts.join(' · ') || 'в игре'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: {
    padding: 10,
    borderRadius: R.md,
    borderWidth: 1,
    backgroundColor: C.elevated,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  value: { color: C.dim, fontFamily: F.mono, fontSize: 12, flex: 1, textAlign: 'right' },
  clock: { color: C.text, fontFamily: F.mono, fontSize: 14 },
  win: { color: C.accent, fontFamily: F.bold, fontSize: 15 },
});

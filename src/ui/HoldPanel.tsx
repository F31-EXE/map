import { Alert, StyleSheet, Text, View } from 'react-native';

import { distanceMeters, formatDistance } from '../lib/geo';
import { BALL_MAX_PUSH, BALL_RADIUS, BALL_SPEED, CAPTURE_MINUTES, checkpointsPassed, matchState, pathLength } from '../lib/gameModes';
import type { SelfPosition, TacMarker } from '../lib/types';
import { useGame } from '../state/game';

import { Button } from './components';
import { C, F, R } from './theme';

/** Fighters must be this close to a flag to capture it. */
const FLAG_REACH_M = 25;

/** Card part of a game flag, territory sector or convoy: its state in the match. */
export function HoldPanel({ marker, self }: { marker: TacMarker; self: SelfPosition | null }) {
  const g = useGame();
  const holder = marker.owner ? g.sideName(marker.owner) : 'ничья';
  const color = marker.owner ? g.sideColor(marker.owner) : C.dim;

  if (marker.kind === 'ball') {
    const b = marker.ball;
    const route = marker.points ?? [];
    const len = pathLength(route);
    const done = len > 0 ? Math.min(1, (b?.progress ?? 0) / len) : 0;
    const passed = checkpointsPassed(route, b?.progress ?? 0);
    const total = Math.max(0, route.length - 1);
    const owner = marker.owner ? g.sideName(marker.owner) : '—';
    const mine = g.mySideId != null && marker.owner === g.mySideId;
    const push = b?.push ?? 0;
    const state = b?.goal
      ? 'доставлен на базу'
      : push > 0
        ? `идёт · ${push * BALL_SPEED} м/мин`
        : 'стоит';
    return (
      <View style={styles.box}>
        <Row label="Конвой стороны" value={owner} color={marker.owner ? g.sideColor(marker.owner) : undefined} />
        <Row label="Чекпойнты" value={`${passed} из ${total}`} />
        <Row label="Пройдено" value={`${Math.round(done * 100)} % · до базы ${formatDistance((1 - done) * len)}`} />
        <Row label="Сейчас" value={state} />
        <Text style={styles.sub}>
          {mine
            ? `Ваш конвой: встаньте в ${BALL_RADIUS} м от него, чтобы вести. Каждый боец рядом даёт ${BALL_SPEED} м/мин (до ${BALL_MAX_PUSH} бойцов), каждый противник рядом отнимает одного. Противников столько же или больше — конвой стоит.`
            : `Конвой противника: встаньте в ${BALL_RADIUS} м от него — каждый из вас останавливает одного из его сопровождения. Сколько их, столько и вас — конвой стоит.`}
        </Text>
      </View>
    );
  }

  if (marker.kind === 'sector') {
    const st = matchState(g.game?.match, Date.now());
    // Who stood here in the latest reported minute (players report mid-minute and
    // keep only that one, so it's this minute or the previous).
    const minute =
      st.phase === 'running'
        ? Math.max(-1, ...g.players.map((p) => (p.cellAt != null && p.cellAt <= st.minute ? p.cellAt : -1)))
        : null;
    const here = minute == null ? [] : g.players.filter((p) => p.cell === marker.id && p.cellAt === minute);
    const counts = g.sides
      .map((s) => ({ s, n: here.filter((p) => p.sideId === s.id).length }))
      .filter((x) => x.n > 0);
    return (
      <View style={styles.box}>
        <Row label="Территория" value={`№ ${marker.label}`} />
        <Row label="Держит" value={holder} color={color} />
        {marker.cap && (
          <Row
            label="Захват"
            value={`${g.sideName(marker.cap.s)} · ${marker.cap.n}/${CAPTURE_MINUTES} мин`}
            color={g.sideColor(marker.cap.s)}
          />
        )}
        {counts.length > 0 && (
          <Row label="Последний отсчёт" value={counts.map((x) => `${x.s.name} ${x.n}`).join(' · ')} />
        )}
        <Text style={styles.sub}>
          Чьих живых бойцов в территории больше {CAPTURE_MINUTES} минуты подряд, тот её и берёт. Поровну — отсчёт
          стоит.
        </Text>
      </View>
    );
  }

  const dist = self ? distanceMeters(self, marker) : null;
  const mine = g.mySideId != null && marker.owner === g.mySideId;
  const canCapture = !g.isTech && g.mySideId != null && !mine;
  return (
    <View style={styles.box}>
      <Row label="Флаг держит" value={holder} color={color} />
      {canCapture && (
        <Button
          title={dist != null && dist > FLAG_REACH_M ? `Захватить · подойдите ближе (${formatDistance(dist)})` : 'Захватить'}
          icon="flag"
          disabled={dist == null || dist > FLAG_REACH_M}
          onPress={() => g.captureFlag(marker).catch((e: Error) => Alert.alert('Не удалось', e.message))}
        />
      )}
      {mine && <Text style={styles.sub}>Флаг ваш: стороне идёт минута за каждую минуту удержания.</Text>}
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 12, borderRadius: R.md, backgroundColor: C.elevated },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: C.dim, fontFamily: F.regular, fontSize: 13, flex: 1 },
  value: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  sub: { color: C.dim, fontSize: 12, fontFamily: F.regular, lineHeight: 17 },
});

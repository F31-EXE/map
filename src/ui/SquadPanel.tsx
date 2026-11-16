import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { distanceMeters } from '../lib/geo';
import { BUILDING_KINDS, BUILDINGS, STRIKE_RADIUS, type BuildingKind } from '../lib/squadMode';
import type { LatLng } from '../lib/types';
import type { SquadView } from '../state/game';

import { Glass, Icon, Sheet, tap } from './components';
import { C, F, R } from './theme';

const ICONS: Record<BuildingKind, 'tent' | 'access-point-off' | 'binoculars' | 'airplane' | 'warehouse'> = {
  'b-fob': 'tent',
  'b-reb': 'access-point-off',
  'b-recon': 'binoculars',
  'b-air': 'airplane',
  'b-depot': 'warehouse',
};

const minLeft = (t: number | null, now: number) => (t == null ? null : t <= now ? 0 : Math.ceil((t - now) / 60_000));

/**
 * SQUAD mode on the map: my pack and my side's bank, «Стройка» for squad commanders and
 * the command post, «Авиаудар» / «Разведка» for the command post. Each picks a spot with
 * the map's place bar (`onPlace`).
 */
export function SquadPanel({
  squad,
  top,
  left,
  onPlace,
}: {
  squad: SquadView;
  top: number;
  left: number;
  onPlace: (k: BuildingKind | 'strike' | 'scan') => void;
}) {
  const [menu, setMenu] = useState(false);
  const now = Date.now();
  const air = minLeft(squad.airReady, now);
  const recon = minLeft(squad.reconReady, now);
  return (
    <>
      <Glass radius={R.md} style={[styles.panel, { top, left }]}>
        <View style={styles.row}>
          <Icon name="pickaxe" size={14} color={C.warn} />
          <Text style={styles.text}>
            {squad.carry}/{squad.limit}
          </Text>
          {squad.bank != null && (
            <Text style={styles.dim}>
              · штаб {Math.floor(squad.bank)} (+{squad.income}/мин)
            </Text>
          )}
        </View>
        {(squad.canBuild || squad.isStaff) && (
          <View style={styles.row}>
            {squad.canBuild && <Chip icon="hammer" text="Стройка" onPress={() => setMenu(true)} />}
            {squad.isStaff && (
              <Chip
                icon="airplane"
                text={air == null ? 'ВВП нет' : air ? `${air} мин` : 'Удар'}
                off={air !== 0}
                onPress={() => onPlace('strike')}
              />
            )}
            {squad.isStaff && (
              <Chip
                icon="radar"
                text={recon == null ? 'Разв. нет' : recon ? `${recon} мин` : 'Разв.'}
                off={recon !== 0}
                onPress={() => onPlace('scan')}
              />
            )}
          </View>
        )}
      </Glass>
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <Text style={styles.title}>Стройка</Text>
        <Text style={styles.dim}>
          Выберите постройку и место (не ближе 200 м к штабам). Бойцы с ресурсами в 15 м от стройки вкладывают по 1 каждые
          5 с; набрать ресурсы — постоять 10 с у своего штаба или склада.
        </Text>
        {BUILDING_KINDS.map((k) => (
          <Pressable
            key={k}
            onPress={() => {
              tap();
              setMenu(false);
              onPlace(k);
            }}
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
          >
            <Icon name={ICONS[k]} size={24} color={C.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>
                {BUILDINGS[k].title} · {BUILDINGS[k].cost}
              </Text>
              <Text style={styles.dim}>{BUILDINGS[k].text}</Text>
            </View>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/** «Авиаудар через 12 с — уходите» for anyone within the blast of a strike on its way. */
export function StrikeBanner({ squad, me, top }: { squad: SquadView; me: LatLng | null; top: number }) {
  const now = Date.now();
  const near = me ? squad.incoming.filter((h) => distanceMeters(me, h) <= STRIKE_RADIUS + 20) : [];
  if (!near.length) return null;
  const left = Math.max(0, Math.ceil((Math.min(...near.map((h) => h.at)) - now) / 1000));
  return (
    <View style={[styles.banner, { top }]} pointerEvents="none">
      <Icon name="bomb" size={22} color="#fff" />
      <Text style={styles.bannerText}>
        {left > 0 ? `АВИАУДАР через ${left} с — уйдите из красного круга!` : 'АВИАУДАР!'}
      </Text>
    </View>
  );
}

function Chip({ icon, text, off, onPress }: { icon: 'hammer' | 'airplane' | 'radar'; text: string; off?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.chip, off && { opacity: 0.55 }]}
    >
      <Icon name={icon} size={14} color={C.text} />
      <Text style={styles.chipText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', paddingHorizontal: 10, paddingVertical: 8, gap: 6, maxWidth: 300 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  text: { color: C.text, fontSize: 13, fontFamily: F.mono },
  dim: { color: C.dim, fontSize: 12, fontFamily: F.regular },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 28,
    borderRadius: R.pill,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.line,
  },
  chipText: { color: C.text, fontSize: 12, fontFamily: F.semibold },
  title: { color: C.text, fontSize: 22, fontFamily: F.bold },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: R.md,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.line,
  },
  itemTitle: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: R.md,
    backgroundColor: '#C81E1E',
  },
  bannerText: { color: '#fff', fontSize: 15, fontFamily: F.bold, flex: 1 },
});

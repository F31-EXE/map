import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelfPosition } from '../hooks/useSelfPosition';
import { bearingDegrees, distanceMeters, formatCoords, formatDistance, timeAgo } from '../lib/geo';
import { isOrder, MARKER_KINDS } from '../lib/markerKinds';
import { ROLES } from '../lib/roles';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { LatLng, MarkerKind, SelfPosition, TacMarker } from '../lib/types';
import {
  BASE_LAYERS,
  STALE_MS,
  TacticalMap,
  type BaseLayerId,
  type TacticalMapHandle,
} from '../map/TacticalMap';
import { useOverlays } from '../state/overlays';
import { useSession, type MarkerScope } from '../state/session';
import { useSide, type OrderTarget } from '../state/side';
import { AddMarkerModal } from '../ui/AddMarkerModal';
import { Avatar, Button, Glass, GlassButton, Icon, RoleIcon, Sheet, tap, type IconName } from '../ui/components';
import { InfoSheet, type Stat } from '../ui/InfoSheet';
import { C, eyebrow, F, R } from '../ui/theme';

type Selection = { type: 'marker' | 'member'; id: string } | null;

function vectorStats(from: SelfPosition | null, to: LatLng): Stat[] {
  if (!from) return [{ label: 'Координаты', value: formatCoords(to) }];
  return [
    { label: 'Дистанция', value: formatDistance(distanceMeters(from, to)) },
    { label: 'Азимут', value: `${Math.round(bearingDegrees(from, to))}°` },
    { label: 'Координаты', value: formatCoords(to) },
  ];
}

function markerSubtitle(m: TacMarker): string {
  const parts = [
    m.label ? MARKER_KINDS[m.kind].title : null,
    m.personal
      ? 'личная метка'
      : isOrder(m.kind)
        ? `${m.audience === 'commanders' ? 'приказ стороны командирам' : 'приказ'}: ${m.createdByName}`
        : m.createdByName,
    timeAgo(m.createdAt),
  ];
  return parts.filter(Boolean).join(' · ');
}

function KindBadge({ kind }: { kind: MarkerKind }) {
  const def = MARKER_KINDS[kind];
  return (
    <View
      style={[
        styles.kindBadge,
        { borderColor: def.color, backgroundColor: def.color + '22' },
        isOrder(kind) && { borderRadius: 14, transform: [{ rotate: '45deg' }] },
      ]}
    >
      <View style={isOrder(kind) ? { transform: [{ rotate: '-45deg' }] } : undefined}>
        <Icon name={def.icon} size={26} color={def.color} />
      </View>
    </View>
  );
}

function gpsColor(acc: number | null | undefined) {
  if (acc == null) return C.faint;
  if (acc <= 10) return C.online;
  if (acc <= 30) return C.warn;
  return C.danger;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const session = useSession();
  const side = useSide();
  const { overlays, focusRequest, requestFocus } = useOverlays();
  const { position, status } = useSelfPosition();
  const mapRef = useRef<TacticalMapHandle>(null);

  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('yandex-sat');
  const [layerPicker, setLayerPicker] = useState(false);
  const [follow, setFollow] = useState(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [addAt, setAddAt] = useState<LatLng | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const centeredOnce = useRef(false);

  useEffect(() => {
    loadJson<BaseLayerId>(KEYS.baseLayer, 'yandex-sat').then(setBaseLayer);
  }, []);

  const chooseLayer = (id: BaseLayerId) => {
    setBaseLayer(id);
    setLayerPicker(false);
    saveJson(KEYS.baseLayer, id);
  };

  // Publish own position to the team (throttled inside the session).
  const { reportPosition } = session;
  useEffect(() => {
    if (position) reportPosition(position);
  }, [position, reportPosition]);

  // Jump to the first GPS fix once, unless an imported map is being focused.
  useEffect(() => {
    if (position && !centeredOnce.current && !focusRequest) {
      centeredOnce.current = true;
      mapRef.current?.setView(position, 16);
    }
  }, [position, focusRequest]);

  // An overlay was just imported/selected on the maps screen; TacticalMap zooms to it.
  const onFocusHandled = useCallback(() => {
    centeredOnce.current = true;
    requestFocus(null);
  }, [requestFocus]);

  const openAdd = useCallback((p: LatLng) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAddAt(p);
  }, []);

  const onMarkerPress = useCallback((id: string) => setSelection({ type: 'marker', id }), []);
  const onMemberPress = useCallback((id: string) => setSelection({ type: 'member', id }), []);

  const saveMarker = async (kind: MarkerKind, label: string, scope: MarkerScope, target: OrderTarget) => {
    if (!addAt) return;
    try {
      const at = { label, lat: addAt.lat, lng: addAt.lng };
      if (isOrder(kind)) await side.placeOrder({ kind, ...at }, target);
      else await session.addMarker({ kind, ...at }, scope);
      setAddAt(null);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Не удалось поставить метку', (e as Error).message);
    }
  };

  const onOverlayError = useCallback((_id: string, message: string) => {
    Alert.alert('Ошибка карты', message);
  }, []);

  const inTeam = Boolean(session.teamId && session.uid);
  const now = Date.now();
  const visibleMembers = side.mapMembers
    .filter((m) => m.id !== session.uid && m.lat != null && m.lng != null)
    .map((m) => ({ lat: m.lat!, lng: m.lng! }));

  // Side commander without a squad of their own: the pill shows the side instead.
  const sideOnly = side.isSideCommander && !inTeam;
  const online = side.mapMembers.filter(
    (m) => m.id !== session.uid && m.updatedAt && now - m.updatedAt < STALE_MS
  ).length;

  const orderTargets: { id: OrderTarget; label: string; color?: string }[] = [
    ...(session.canCommand ? [{ id: 'own', label: 'Мой отряд', color: session.teamColor }] : []),
    ...(side.isSideCommander
      ? [
          { id: 'all', label: 'Командирам всех отрядов' },
          ...side.squads.map((sq) => ({ id: sq.id, label: sq.name, color: sq.displayColor })),
        ]
      : []),
  ];

  const selectedMarker =
    selection?.type === 'marker' ? side.mapMarkers.find((m) => m.id === selection.id) : undefined;
  const selectedMember =
    selection?.type === 'member' ? side.mapMembers.find((m) => m.id === selection.id) : undefined;

  const banner =
    status === 'denied'
      ? 'Нет доступа к геолокации — разрешите его в настройках телефона'
      : inTeam && session.teamError
        ? session.teamError
        : null;

  return (
    <View style={styles.root}>
      <TacticalMap
        ref={mapRef}
        baseLayer={baseLayer}
        self={position}
        follow={follow}
        members={side.mapMembers}
        selfId={session.uid}
        teamColor={session.teamColor}
        ownerId={session.team?.ownerId ?? null}
        markers={side.mapMarkers}
        overlays={overlays}
        focusOverlay={focusRequest}
        onFocusHandled={onFocusHandled}
        onLongPress={openAdd}
        onMarkerPress={onMarkerPress}
        onMemberPress={onMemberPress}
        onViewChanged={setCenter}
        onFollowChanged={setFollow}
        onOverlayError={onOverlayError}
      />

      <Reticle />

      {/* Top: team status + tools */}
      <View
        style={[
          styles.top,
          { top: insets.top + 10, left: 12 + insets.left, right: 12 + insets.right },
          landscape && { right: undefined, width: Math.min(420, width - 100) },
        ]}
      >
        <Pressable
          style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}
          onPress={() => {
            tap();
            router.push(sideOnly ? '/side' : '/team');
          }}
        >
          <Glass radius={R.pill} style={styles.teamPill}>
            <View
              style={[
                styles.teamIcon,
                { backgroundColor: inTeam || sideOnly ? C.accentSoft : 'rgba(255,255,255,0.06)' },
              ]}
            >
              <Icon
                name={sideOnly ? 'flag-variant' : inTeam ? 'account-group' : 'account'}
                size={18}
                color={inTeam || sideOnly ? C.accent : C.dim}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamTitle} numberOfLines={1}>
                {sideOnly
                  ? (side.side?.name ?? '…')
                  : inTeam
                    ? (session.team?.name ?? '…')
                    : session.callsign || 'Позывной не задан'}
              </Text>
              <View style={styles.teamSubRow}>
                {(inTeam || sideOnly) && (
                  <View style={[styles.liveDot, { backgroundColor: online ? C.online : C.faint }]} />
                )}
                <Text style={styles.teamSub} numberOfLines={1}>
                  {sideOnly
                    ? `Сторона · ${side.squads.length} отр. · ${online} в сети`
                    : inTeam
                      ? `${online} в сети · ${session.members.length} в составе${side.isSideCommander ? ' · сторона' : ''}`
                      : 'Нажмите, чтобы собрать команду'}
                </Text>
              </View>
            </View>
            <Icon name="chevron-right" size={20} color={C.faint} />
          </Glass>
        </Pressable>
      </View>

      <View style={[styles.tools, { top: insets.top + 74, right: 12 + insets.right }]}>
        <Glass radius={R.lg} style={styles.toolbar}>
          <ToolbarButton icon="layers-triple-outline" label="Подложка" onPress={() => setLayerPicker(true)} />
          <View style={styles.toolbarSep} />
          <ToolbarButton icon="map-plus" label="Карты полигона" onPress={() => router.push('/maps')} />
          {visibleMembers.length > 0 && (
            <>
              <View style={styles.toolbarSep} />
              <ToolbarButton
                icon="account-group-outline"
                label="Показать всех"
                onPress={() => mapRef.current?.fitPoints(visibleMembers)}
              />
            </>
          )}
        </Glass>
      </View>

      {banner && (
        <Glass
          radius={R.md}
          style={[
            styles.banner,
            { top: insets.top + 74, left: 12 + insets.left },
            landscape && { right: undefined, width: Math.min(420, width - 100) },
          ]}
        >
          <Icon name="alert-circle" size={18} color={C.danger} />
          <Text style={styles.bannerText}>{banner}</Text>
        </Glass>
      )}

      {/* Bottom-right actions */}
      <View
        style={[
          styles.actions,
          { bottom: insets.bottom + (landscape ? 12 : 108), right: 12 + insets.right },
          landscape && { flexDirection: 'row-reverse' },
        ]}
      >
        <GlassButton
          icon={follow ? 'crosshairs-gps' : 'crosshairs'}
          label="Моё местоположение"
          size={52}
          active={follow}
          onPress={() => {
            if (!position) {
              Alert.alert('Нет GPS', 'Координаты ещё не определены');
              return;
            }
            if (follow) setFollow(false);
            else {
              mapRef.current?.centerOnSelf();
              setFollow(true);
            }
          }}
        />
        <Pressable
          accessibilityLabel="Поставить метку в перекрестие"
          onPress={() => center && openAdd(center)}
          style={({ pressed }) => [styles.fab, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <Icon name="map-marker-plus" size={28} color={C.accentInk} />
        </Pressable>
      </View>

      {/* Bottom HUD */}
      <Glass
        radius={R.lg}
        style={[
          styles.hud,
          { bottom: insets.bottom + 12, left: 12 + insets.left, right: 12 + insets.right },
          landscape && { right: undefined, width: Math.min(520, width - 200 - insets.left - insets.right) },
        ]}
      >
        <View style={{ flex: 1.3 }}>
          <Text style={eyebrow}>Перекрестие</Text>
          <Text style={styles.hudValue} numberOfLines={1}>
            {center ? formatCoords(center) : '—'}
          </Text>
        </View>
        <View style={styles.hudSep} />
        <View style={{ flex: 1 }}>
          <Text style={eyebrow}>От меня</Text>
          <Text style={styles.hudValue} numberOfLines={1}>
            {center && position
              ? `${formatDistance(distanceMeters(position, center))} · ${Math.round(bearingDegrees(position, center))}°`
              : '—'}
          </Text>
        </View>
        <View style={styles.gps}>
          <View style={[styles.gpsDot, { backgroundColor: gpsColor(position?.accuracy) }]} />
          <Text style={styles.gpsText}>
            {position?.accuracy != null ? `±${Math.round(position.accuracy)}м` : 'GPS'}
          </Text>
        </View>
      </Glass>

      <AddMarkerModal
        at={addAt}
        inTeam={inTeam}
        canCommand={session.canCommand || side.isSideCommander}
        orderTargets={orderTargets}
        onCancel={() => setAddAt(null)}
        onSave={saveMarker}
      />

      {/* Marker details */}
      <InfoSheet
        visible={!!selectedMarker}
        onClose={() => setSelection(null)}
        leading={selectedMarker && <KindBadge kind={selectedMarker.kind} />}
        title={selectedMarker?.label || (selectedMarker ? MARKER_KINDS[selectedMarker.kind].title : '')}
        subtitle={selectedMarker && markerSubtitle(selectedMarker)}
        stats={selectedMarker ? vectorStats(position, selectedMarker) : []}
      >
        {selectedMarker &&
          (!isOrder(selectedMarker.kind) || session.canCommand || side.isSideCommander) && (
          <Button
            title={isOrder(selectedMarker.kind) ? 'Отменить приказ' : 'Удалить метку'}
            kind="danger"
            icon="trash-can-outline"
            onPress={() => {
              side
                .deleteMarker(selectedMarker)
                .then(() => setSelection(null))
                .catch((e: Error) => Alert.alert('Ошибка', e.message));
            }}
          />
        )}
      </InfoSheet>

      {/* Teammate details */}
      <InfoSheet
        visible={!!selectedMember && selectedMember.lat != null}
        onClose={() => setSelection(null)}
        leading={
          selectedMember && (
            <View>
              <Avatar
                name={selectedMember.callsign}
                color={selectedMember.color ?? session.teamColor}
                uri={session.avatars[selectedMember.id]}
                size={56}
                dim={!selectedMember.updatedAt || now - selectedMember.updatedAt > STALE_MS}
              />
              <View style={[styles.roleBadge, { backgroundColor: selectedMember.color ?? session.teamColor }]}>
                <RoleIcon role={selectedMember.role} size={16} color={C.accentInk} />
              </View>
            </View>
          )
        }
        title={selectedMember?.callsign ?? ''}
        subtitle={
          selectedMember &&
          [
            ROLES[selectedMember.role].title,
            selectedMember.canCommand || selectedMember.id === session.team?.ownerId ? 'отдаёт приказы' : null,
            selectedMember.updatedAt ? `на связи ${timeAgo(selectedMember.updatedAt)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        }
        stats={
          selectedMember && selectedMember.lat != null && selectedMember.lng != null
            ? vectorStats(position, { lat: selectedMember.lat, lng: selectedMember.lng })
            : []
        }
      />

      {/* Base layer picker */}
      <Sheet visible={layerPicker} onClose={() => setLayerPicker(false)}>
        <Text style={styles.sheetTitle}>Подложка</Text>
        <View style={styles.layerGrid}>
          {BASE_LAYERS.map((l) => {
            const selected = l.id === baseLayer;
            return (
              <Pressable
                key={l.id}
                onPress={() => {
                  tap();
                  chooseLayer(l.id);
                }}
                style={[styles.layerCard, selected && styles.layerCardSelected]}
              >
                <View style={[styles.layerIcon, selected && { backgroundColor: C.accent }]}>
                  <Icon name={l.icon} size={22} color={selected ? C.accentInk : C.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.layerTitle}>{l.title}</Text>
                  <Text style={styles.layerProvider}>{l.provider}</Text>
                </View>
                {selected && <Icon name="check-circle" size={20} color={C.accent} />}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

function ToolbarButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={4}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.toolbarButton, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={22} />
    </Pressable>
  );
}

/** Thin aiming reticle in the middle of the map: "+" places markers exactly here. */
function Reticle() {
  return (
    <View pointerEvents="none" style={styles.reticleWrap}>
      <View style={styles.reticle}>
        <View style={[styles.tick, styles.tickTop]} />
        <View style={[styles.tick, styles.tickBottom]} />
        <View style={[styles.tickH, styles.tickLeft]} />
        <View style={[styles.tickH, styles.tickRight]} />
        <View style={styles.reticleDot} />
      </View>
    </View>
  );
}

const TICK = 9;
const GAP = 7;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', gap: 10 },
  teamPill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 6, paddingRight: 12, height: 54 },
  teamIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  teamTitle: { color: C.text, fontSize: 15, fontFamily: F.bold },
  teamSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  teamSub: { color: C.dim, fontSize: 12, fontFamily: F.regular },

  tools: { position: 'absolute', right: 12 },
  toolbar: { paddingVertical: 4, width: 50, alignItems: 'center' },
  toolbarButton: { width: 50, height: 46, alignItems: 'center', justifyContent: 'center' },
  toolbarSep: { width: 26, height: StyleSheet.hairlineWidth, backgroundColor: C.lineStrong },

  banner: {
    position: 'absolute',
    left: 12,
    right: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.danger,
  },
  bannerText: { color: C.text, fontSize: 13, fontFamily: F.regular, flex: 1 },

  actions: { position: 'absolute', right: 12, alignItems: 'center', gap: 14 },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.accent,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },

  hud: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  hudValue: { color: C.text, fontSize: 13, fontFamily: F.mono, marginTop: 3 },
  hudSep: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.lineStrong },
  gps: {
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { color: C.dim, fontSize: 11, fontFamily: F.mono },

  roleBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetTitle: { color: C.text, fontSize: 22, fontFamily: F.bold },
  layerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  layerCard: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: R.md,
    backgroundColor: C.elevated,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  layerCardSelected: { borderColor: C.accent, backgroundColor: C.accentSoft },
  layerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  layerTitle: { color: C.text, fontSize: 15, fontFamily: F.semibold },
  layerProvider: { color: C.dim, fontSize: 12, fontFamily: F.regular },

  reticleWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 2 * (TICK + GAP), height: 2 * (TICK + GAP) },
  tick: {
    position: 'absolute',
    left: TICK + GAP - 1,
    width: 2,
    height: TICK,
    backgroundColor: '#fff',
    borderRadius: 1,
    shadowColor: '#000',
    shadowOpacity: 0.9,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 0 },
  },
  tickTop: { top: 0 },
  tickBottom: { bottom: 0 },
  tickH: {
    position: 'absolute',
    top: TICK + GAP - 1,
    height: 2,
    width: TICK,
    backgroundColor: '#fff',
    borderRadius: 1,
    shadowColor: '#000',
    shadowOpacity: 0.9,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 0 },
  },
  tickLeft: { left: 0 },
  tickRight: { right: 0 },
  reticleDot: {
    position: 'absolute',
    left: TICK + GAP - 2,
    top: TICK + GAP - 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
  },
});

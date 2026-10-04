import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelfPosition } from '../../hooks/useSelfPosition';
import { bearingDegrees, distanceMeters, formatClock, formatCoords, formatDistance, timeAgo } from '../../lib/geo';
import { isOrder, MARKER_KINDS, voteThreshold } from '../../lib/markerKinds';
import { ROLES } from '../../lib/roles';
import { STATUSES } from '../../lib/status';
import { KEYS, loadJson, saveJson } from '../../lib/storage';
import type { LatLng, MarkerKind, SelfPosition, TacMarker } from '../../lib/types';
import {
  BASE_LAYERS,
  STALE_MS,
  TacticalMap,
  type BaseLayerId,
  type TacticalMapHandle,
} from '../../map/TacticalMap';
import { markerErrorText } from '../../services/teams';
import { useOverlays } from '../../state/overlays';
import { useSession, type MarkerScope } from '../../state/session';
import { useSide, type OrderTarget } from '../../state/side';
import { AddMarkerModal } from '../../ui/AddMarkerModal';
import { Avatar, Button, Glass, GlassButton, Icon, RoleIcon, Sheet, tap, type IconName } from '../../ui/components';
import { InfoSheet, type Stat } from '../../ui/InfoSheet';
import { C, eyebrow, F, R } from '../../ui/theme';

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
    `в ${formatClock(m.createdAt)} (${timeAgo(m.createdAt)})`,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** "Неактуально" for any marker, plus "Выполнено" for orders; enough votes hide it for everyone. */
function VoteRow({
  marker,
  uid,
  threshold,
  onVote,
}: {
  marker: TacMarker;
  uid: string | null;
  threshold: number;
  onVote: (vote: 'stale' | 'done') => void;
}) {
  const stale = marker.staleVotes ?? [];
  const done = marker.doneVotes ?? [];
  const voted = uid != null && (stale.includes(uid) || done.includes(uid));
  return (
    <View style={styles.voteRow}>
      <Button
        title={`Неактуально ${stale.length}/${threshold}`}
        icon="clock-alert-outline"
        kind="secondary"
        disabled={voted}
        style={{ flex: 1 }}
        onPress={() => onVote('stale')}
      />
      {isOrder(marker.kind) && (
        <Button
          title={`Выполнено ${done.length}/${threshold}`}
          icon="check-circle-outline"
          kind="secondary"
          disabled={voted}
          style={{ flex: 1 }}
          onPress={() => onVote('done')}
        />
      )}
    </View>
  );
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
  const safe = useSafeAreaInsets();
  const window = useWindowDimensions();
  const landscape = window.width > window.height;
  // This screen's own size: in landscape the tab bar takes a column on the left.
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const width = area?.width ?? window.width;
  const height = area?.height ?? window.height;
  // The tab bar owns the bottom edge (portrait) or the left edge (landscape).
  const insets = { top: safe.top, bottom: 0, left: landscape ? 0 : safe.left, right: safe.right };
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
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  // Top edge of the bottom HUD, measured, so the map's scale bar sits above it.
  const [hudTop, setHudTop] = useState<number | null>(null);
  const drawingRef = useRef(false);
  drawingRef.current = drawing != null;
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
    if (drawingRef.current) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setAddAt(p);
  }, []);

  const onMarkerPress = useCallback((id: string) => setSelection({ type: 'marker', id }), []);

  // Own point markers can be picked up with a long press and dragged. Side orders
  // are copies in several squads, and arrows are paths, so those stay put.
  const { uid, teamId, moveMarker } = session;
  const isMovable = useCallback(
    (m: TacMarker) =>
      !m.groupId &&
      m.kind !== 'arrow' &&
      (m.personal || (m.createdBy === uid && (!m.teamId || m.teamId === teamId))),
    [uid, teamId]
  );
  const onMarkerDragStart = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, []);
  const markersRef = useRef(side.mapMarkers);
  markersRef.current = side.mapMarkers;
  const onMarkerMoved = useCallback(
    (id: string, p: LatLng) => {
      const m = markersRef.current.find((x) => x.id === id);
      if (!m) return;
      moveMarker(m, p).catch((e: Error) => Alert.alert('Не удалось переместить', markerErrorText(e)));
    },
    [moveMarker]
  );
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
  const pillTop = insets.top + 10;
  const visibleMembers = side.mapMembers
    .filter((m) => m.id !== session.uid && m.lat != null && m.lng != null)
    .map((m) => ({ lat: m.lat!, lng: m.lng! }));

  // Votes apply to my own squad's shared markers.
  const canVote = (m: TacMarker) => inTeam && !m.personal && (!m.teamId || m.teamId === session.teamId);

  const toolbarButtons = 4 + (visibleMembers.length > 0 ? 1 : 0);
  const toolbarWidth = toolbarButtons * 50 + 8;

  // Landscape top row: [team pill][toolbar].
  const pillW = Math.min(420, width - insets.left - insets.right - 24 - toolbarWidth - 10);
  // Landscape bottom row: [HUD][FAB][locate][status] — buttons are 64 + 52 + 52 plus gaps.
  const actionsW = 64 + 52 + (inTeam ? 52 + 14 : 0) + 14;

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
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setArea((a) => (a && a.width === w && a.height === h ? a : { width: w, height: h }));
      }}
    >
      <TacticalMap
        ref={mapRef}
        baseLayer={baseLayer}
        self={position}
        selfRole={session.role}
        selfColor={session.teamColor}
        grid={session.showGrid}
        topInset={landscape ? insets.top + 60 : pillTop + 58}
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
        isMovable={isMovable}
        onMarkerDragStart={onMarkerDragStart}
        onMarkerMoved={onMarkerMoved}
        onMemberPress={onMemberPress}
        onViewChanged={setCenter}
        onFollowChanged={setFollow}
        onOverlayError={onOverlayError}
        bottomInset={hudTop == null ? undefined : height - hudTop + 6}
        drawing={drawing}
        onDrawChanged={(points) => setDrawing((d) => (d ? { ...d, points } : d))}
      />

      <Reticle />


      {/* Top: team status + tools */}
      <View
        style={[
          styles.top,
          { top: pillTop, left: 12 + insets.left, right: 12 + insets.right },
          landscape && { right: undefined, width: pillW },
        ]}
      >
        <Pressable
          style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}
          onPress={() => {
            tap();
            if (sideOnly) router.push('/side');
            else router.navigate('/team');
          }}
        >
          <Glass radius={R.lg} style={[styles.teamPill, landscape && styles.teamPillCompact]}>
            <View
              style={[
                styles.teamIcon,
                landscape && styles.teamIconCompact,
                { backgroundColor: inTeam || sideOnly ? C.accentSoft : C.elevated },
              ]}
            >
              <Icon
                name={sideOnly ? 'flag-variant' : inTeam ? 'account-group' : 'account'}
                size={landscape ? 15 : 18}
                color={inTeam || sideOnly ? C.accent : C.dim}
              />
            </View>
            {/* Landscape: one line, title and status side by side. */}
            <View style={[{ flex: 1 }, landscape && styles.teamTextCompact]}>
              <Text style={[styles.teamTitle, landscape && styles.teamTitleCompact]} numberOfLines={1}>
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
                      ? landscape
                        ? `${online}/${session.members.length}`
                        : `${online} в сети · ${session.members.length} в составе${side.isSideCommander ? ' · сторона' : ''}`
                      : 'Нажмите, чтобы собрать команду'}
                </Text>
              </View>
            </View>
            {session.mesh.enabled && session.mesh.available && inTeam && (
              <View style={[styles.meshChip, session.mesh.peers > 0 && styles.meshChipOn]}>
                <Icon name="bluetooth" size={13} color={session.mesh.peers > 0 ? C.info : C.faint} />
                <Text style={[styles.meshText, session.mesh.peers > 0 && { color: C.info }]}>{session.mesh.peers}</Text>
              </View>
            )}
            {session.team?.recordingId && (
              <View style={styles.rec}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>REC</Text>
              </View>
            )}
            <Icon name="chevron-right" size={landscape ? 16 : 20} color={C.faint} />
          </Glass>
        </Pressable>
      </View>

      {/* Portrait: a column under the team pill. Landscape: a row beside it, so it can't
          run into the bottom-right buttons on short screens. */}
      <View style={[styles.tools, { top: landscape ? insets.top + 10 : pillTop + 64, right: 12 + insets.right }]}>
        <Glass radius={R.lg} style={[styles.toolbar, landscape && styles.toolbarRow]}>
          <ToolbarButton icon="layers-triple-outline" label="Подложка" onPress={() => setLayerPicker(true)} />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton icon="map-plus" label="Карты полигона" onPress={() => router.push('/maps')} />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton
            icon={session.showGrid ? 'grid' : 'grid-off'}
            label="Сетка координат"
            active={session.showGrid}
            onPress={() => session.setShowGrid(!session.showGrid)}
          />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton
            icon="draw"
            label="Нарисовать стрелку"
            onPress={() => {
              setFollow(false);
              setDrawing({ color: ARROW_COLORS[0], points: [], scope: 'team' });
            }}
          />
          {visibleMembers.length > 0 && (
            <>
              <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
              <ToolbarButton
                icon="fit-to-screen-outline"
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
            { top: pillTop + 64, left: 12 + insets.left },
            landscape && { right: undefined, width: Math.min(420, pillW) },
          ]}
        >
          <Icon name="alert-circle" size={18} color={C.danger} />
          <Text style={styles.bannerText}>{banner}</Text>
        </Glass>
      )}

      {drawing && (
        <DrawBar
          drawing={drawing}
          inTeam={inTeam}
          bottom={insets.bottom + 12}
          left={12 + insets.left}
          right={12 + insets.right}
          onChange={setDrawing}
          onCancel={() => setDrawing(null)}
          onDone={async () => {
            const pts = drawing.points;
            try {
              await session.addMarker(
                {
                  kind: 'arrow',
                  label: '',
                  lat: pts[pts.length - 1].lat,
                  lng: pts[pts.length - 1].lng,
                  points: pts,
                  color: drawing.color,
                },
                inTeam ? drawing.scope : 'personal'
              );
              setDrawing(null);
            } catch (e) {
              Alert.alert('Не удалось сохранить стрелку', (e as Error).message);
            }
          }}
        />
      )}

      {/* Bottom-right actions */}
      <View
        pointerEvents={drawing ? 'none' : 'auto'}
        style={[
          drawing && { opacity: 0 },
          styles.actions,
          { bottom: insets.bottom + (landscape ? 12 : 108), right: 12 + insets.right },
          landscape && { flexDirection: 'row-reverse' },
        ]}
      >
        {inTeam && (
          <GlassButton
            icon="skull"
            label={session.status === 'dead' ? 'Я снова в игре' : 'Я убит'}
            size={52}
            active={session.status === 'dead'}
            activeColor={C.danger}
            onPress={() => {
              const next = session.status === 'dead' ? 'alive' : 'dead';
              session.setStatus(next).catch((e: Error) => Alert.alert('Ошибка', e.message));
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            }}
          />
        )}
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
        onLayout={(e) => setHudTop(e.nativeEvent.layout.y)}
        style={[
          drawing && { display: 'none' },
          styles.hud,
          { bottom: insets.bottom + 12, left: 12 + insets.left, right: 12 + insets.right },
          landscape && styles.hudCompact,
          landscape && {
            right: undefined,
            width: Math.min(460, width - insets.left - insets.right - 24 - actionsW - 12),
          },
        ]}
      >
        <View style={{ flex: 1.3 }}>
          {!landscape && <Text style={eyebrow}>Перекрестие</Text>}
          <Text style={[styles.hudValue, landscape && styles.hudValueCompact]} numberOfLines={1}>
            {center ? formatCoords(center) : '—'}
          </Text>
        </View>
        <View style={styles.hudSep} />
        <View style={{ flex: 1 }}>
          {!landscape && <Text style={eyebrow}>От меня</Text>}
          <Text style={[styles.hudValue, landscape && styles.hudValueCompact]} numberOfLines={1}>
            {center && position
              ? `${formatDistance(distanceMeters(position, center))} · ${Math.round(bearingDegrees(position, center))}°`
              : '—'}
          </Text>
        </View>
        <View style={[styles.gps, landscape && styles.gpsCompact]}>
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
        {selectedMarker && canVote(selectedMarker) && (
          <VoteRow
            marker={selectedMarker}
            uid={session.uid}
            threshold={voteThreshold(session.members.length)}
            onVote={(vote) =>
              session
                .voteMarker(selectedMarker, vote)
                .then(() => setSelection(null))
                .catch((e: Error) => Alert.alert('Ошибка', e.message))
            }
          />
        )}
        {selectedMarker && side.canDelete(selectedMarker) && (
          <Button
            title={isOrder(selectedMarker.kind) ? 'Отменить приказ' : 'Удалить метку'}
            kind="danger"
            icon="trash-can-outline"
            onPress={() => {
              side
                .deleteMarker(selectedMarker)
                .then(() => setSelection(null))
                .catch((e: Error) => Alert.alert('Не удалось удалить', markerErrorText(e)));
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
            selectedMember.status !== 'alive' ? STATUSES[selectedMember.status].title.toUpperCase() : null,
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

type Drawing = { color: string; points: LatLng[]; scope: MarkerScope };

const ARROW_COLORS = ['#FFC83D', '#FF4D4D', '#3D9BFF', '#4ADE80', '#F5F5F5'];

/** Controls shown while drawing an arrow: color, audience, undo, cancel, done. */
function DrawBar({
  drawing,
  inTeam,
  bottom,
  left,
  right,
  onChange,
  onCancel,
  onDone,
}: {
  drawing: Drawing;
  inTeam: boolean;
  bottom: number;
  left: number;
  right: number;
  onChange: (d: Drawing) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const n = drawing.points.length;
  return (
    <Glass radius={R.lg} style={[styles.drawBar, { bottom, left, right }]}>
      <View style={styles.drawHeader}>
        <Icon name="draw" size={20} color={drawing.color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.drawTitle}>Стрелка · {n} {n === 1 ? 'точка' : n >= 2 && n <= 4 ? 'точки' : 'точек'}</Text>
          <Text style={styles.drawHint} numberOfLines={1}>
            Нажимайте по карте от начала к острию
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Убрать последнюю точку"
          disabled={n === 0}
          hitSlop={6}
          style={[styles.drawIcon, n === 0 && { opacity: 0.35 }]}
          onPress={() => {
            tap();
            onChange({ ...drawing, points: drawing.points.slice(0, -1) });
          }}
        >
          <Icon name="undo-variant" size={20} />
        </Pressable>
      </View>
      <View style={styles.drawRow}>
        {ARROW_COLORS.map((c) => (
          <Pressable
            key={c}
            accessibilityLabel={`Цвет стрелки ${c}`}
            onPress={() => {
              tap();
              onChange({ ...drawing, color: c });
            }}
            style={[styles.drawColor, { backgroundColor: c }, c === drawing.color && styles.drawColorActive]}
          />
        ))}
        {inTeam && (
          <Pressable
            onPress={() => {
              tap();
              onChange({ ...drawing, scope: drawing.scope === 'team' ? 'personal' : 'team' });
            }}
            style={styles.drawScope}
          >
            <Icon name={drawing.scope === 'team' ? 'account-group' : 'eye-off-outline'} size={16} color={C.text} />
            <Text style={styles.drawScopeText}>{drawing.scope === 'team' ? 'Бойцам' : 'Только мне'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.drawRow}>
        <Button title="Отмена" kind="secondary" onPress={onCancel} style={{ flex: 1, minHeight: 44 }} />
        <Button
          title="Готово"
          icon="check"
          disabled={n < 2}
          onPress={onDone}
          style={{ flex: 1.4, minHeight: 44 }}
        />
      </View>
    </Glass>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={4}
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityState={active == null ? undefined : { selected: active }}
      style={({ pressed }) => [styles.toolbarButton, pressed && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={22} color={active ? C.accent : C.text} />
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
  teamIcon: { width: 42, height: 42, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' },
  teamTitle: { color: C.text, fontSize: 14, fontFamily: F.mono, letterSpacing: 1, textTransform: 'uppercase' },
  teamSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  teamSub: { color: C.dim, fontSize: 12, fontFamily: F.regular },
  teamPillCompact: { height: 46, gap: 8, paddingLeft: 6, paddingRight: 10 },
  teamIconCompact: { width: 30, height: 30, borderRadius: R.sm },
  teamTextCompact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamTitleCompact: { fontSize: 14, flexShrink: 1 },

  tools: { position: 'absolute', right: 12 },
  toolbar: { paddingVertical: 4, width: 50, alignItems: 'center' },
  toolbarButton: { width: 50, height: 46, alignItems: 'center', justifyContent: 'center' },
  toolbarSep: { width: 26, height: StyleSheet.hairlineWidth, backgroundColor: C.lineStrong },
  toolbarRow: { flexDirection: 'row', width: 'auto', paddingVertical: 0, paddingHorizontal: 4, height: 46 },
  toolbarSepRow: { width: StyleSheet.hairlineWidth, height: 24 },

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
    borderRadius: R.lg,
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
  hudValue: { color: C.accent, fontSize: 13, fontFamily: F.mono, marginTop: 3 },
  hudCompact: { paddingVertical: 7, paddingHorizontal: 12, gap: 10 },
  hudValueCompact: { fontSize: 12, marginTop: 0 },
  gpsCompact: { flexDirection: 'row', gap: 5, paddingLeft: 0 },
  hudSep: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.lineStrong },
  gps: {
    alignItems: 'center',
    gap: 4,
    paddingLeft: 4,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { color: C.dim, fontSize: 11, fontFamily: F.mono },

  voteRow: { flexDirection: 'row', gap: 10 },
  rec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: R.pill,
    backgroundColor: C.dangerSoft,
  },
  meshChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.line,
  },
  meshChipOn: { borderColor: 'rgba(92, 200, 255, 0.5)' },
  meshText: { color: C.faint, fontSize: 11, fontFamily: F.mono },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.danger },
  recText: { color: C.danger, fontSize: 11, fontFamily: F.bold, letterSpacing: 0.8 },
  drawBar: { position: 'absolute', padding: 12, gap: 10, maxWidth: 520 },
  drawHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  drawTitle: { color: C.text, fontSize: 15, fontFamily: F.bold },
  drawHint: { color: C.dim, fontSize: 12, fontFamily: F.regular },
  drawIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  drawColor: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  drawColorActive: { borderColor: C.text },
  drawScope: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: R.pill,
    backgroundColor: C.elevated,
  },
  drawScopeText: { color: C.text, fontSize: 13, fontFamily: F.semibold },
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
    backgroundColor: C.elevated,
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

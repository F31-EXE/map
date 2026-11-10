import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSelfPosition } from '../../hooks/useSelfPosition';
import { bearingDegrees, distanceMeters, formatClock, formatCoords, formatDistance, timeAgo } from '../../lib/geo';
import { centroid, isArea, ZoneWatcher, type Area, type AreaKind } from '../../lib/geofence';
import { turnText } from '../../lib/heading';
import { ARRIVE_M, etaSeconds, formatEta, SpeedTracker } from '../../lib/nav';
import { recentTrail } from '../../lib/trail';
import { hotState, type HotZone } from '../../lib/hotzone';
import { isOrder, MARKER_KINDS, voteThreshold } from '../../lib/markerKinds';
import { correct, DEFAULT_RANGE, solve } from '../../lib/mortar';
import { ROLES } from '../../lib/roles';
import { STATUSES } from '../../lib/status';
import { KEYS, loadJson, saveJson } from '../../lib/storage';
import type { Bounds } from '../../lib/tiles';
import { HqPanel, type HqGroup } from '../../ui/HqPanel';
import { powerText } from '../../lib/power';
import type { GameSide, LatLng, MarkerKind, SelfPosition, TacMarker } from '../../lib/types';
import {
  BASE_LAYERS,
  STALE_MS,
  TacticalMap,
  type BaseLayerId,
  type TacticalMapHandle,
} from '../../map/TacticalMap';
import { OFFLINE_SUPPORTED, offlineRootUri } from '../../services/offlineMaps';
import { markerErrorText } from '../../services/teams';
import { useOverlays } from '../../state/overlays';
import { useRegions } from '../../state/regions';
import { useSession, type MarkerScope } from '../../state/session';
import { useSide, type OrderTarget } from '../../state/side';
import { useNight } from '../../state/night';
import { useTrail, useTrailMinutes } from '../../state/trail';
import { useMortar } from '../../state/useMortar';
import { AddMarkerModal } from '../../ui/AddMarkerModal';
import { OfflineSheet } from '../../ui/OfflineSheet';
import { RegionPrompt } from '../../ui/RegionPrompt';
import { GridSheet } from '../../ui/GridSheet';
import { NavPanel } from '../../ui/NavPanel';
import { HoldPanel } from '../../ui/HoldPanel';
import { PhotoView } from '../../ui/PhotoView';
import { takePhoto } from '../../services/photo';
import { fireText, MortarPanel, MortarSheet } from '../../ui/MortarPanel';
import { WavePanel } from '../../ui/WavePanel';
import { GameScore } from '../../ui/GameScore';
import { HOT, phaseText, selfInZone, useNow, ZonePanel } from '../../ui/ZonePanel';
import { useGame } from '../../state/game';
import { Avatar, Button, Glass, GlassButton, Icon, RoleIcon, Sheet, tap, type IconName } from '../../ui/components';
import { InfoSheet, type Stat } from '../../ui/InfoSheet';
import { C, eyebrow, F, R } from '../../ui/theme';

type Selection = { type: 'marker' | 'member'; id: string } | null;

function vectorStats(from: SelfPosition | null, to: LatLng, heading: number | null): Stat[] {
  if (!from) return [{ label: 'Координаты', value: formatCoords(to) }];
  const bearing = bearingDegrees(from, to);
  return [
    { label: 'Дистанция', value: formatDistance(distanceMeters(from, to)) },
    { label: 'Азимут', value: `${Math.round(bearing)}°` },
    // Where I'm looking, and which way to turn to face it.
    ...(heading != null
      ? [
          { label: 'Мой курс', value: `${Math.round(heading)}°` },
          { label: 'Повернуть', value: turnText(heading, bearing) },
        ]
      : []),
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

/** Top-left status of the hot zone: am I in it, how far, when it moves. */
function ZoneChip({
  marker,
  self,
  score,
  style,
  onPress,
}: {
  marker: TacMarker;
  self: SelfPosition | null;
  /** Game score under the zone status (big games). */
  score?: ReactNode;
  style: object;
  onPress: () => void;
}) {
  const now = useNow();
  const st = hotState(marker, marker.zone!, now);
  const me = selfInZone(self, marker, st);
  const alert = st.phase !== 'hold';
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.zoneChipWrap, style]}
    >
      <Glass radius={R.md} style={[styles.zoneChip, me?.inHot && { borderColor: HOT }]}>
        <Icon name="fire" size={18} color={HOT} />
        <View>
          <Text style={[styles.zoneChipTitle, me?.inHot && { color: HOT }]} numberOfLines={1}>
            {!me
              ? 'Хотзона'
              : me.inHot
                ? 'В хотзоне'
                : `${formatDistance(me.toHotEdge)} · ${Math.round(me.bearing)}°`}
          </Text>
          <Text style={[styles.zoneChipSub, alert && { color: C.warn }]} numberOfLines={1}>
            {phaseText(st, now)}
          </Text>
          {score && <View style={{ marginTop: 5 }}>{score}</View>}
        </View>
      </Glass>
    </Pressable>
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
  // HQ panel beside the map on wide screens (a laptop at the command post).
  const wide = window.width >= 1000;
  const [hqOn, setHqOn] = useState(true);
  useEffect(() => {
    loadJson<boolean>(KEYS.hq, true).then(setHqOn);
  }, []);
  const toggleHq = () => {
    setHqOn((v) => {
      saveJson(KEYS.hq, !v).catch(() => {});
      return !v;
    });
  };
  const hqWidth = wide && hqOn ? Math.min(400, Math.round(window.width * 0.3)) : 0;
  const landscape = window.width > window.height;
  // This screen's own size: in landscape the tab bar takes a column on the left.
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const width = area?.width ?? window.width;
  const height = area?.height ?? window.height;
  // The tab bar owns the bottom edge (portrait) or the left edge (landscape).
  const insets = { top: safe.top, bottom: 0, left: landscape ? 0 : safe.left, right: safe.right };
  const session = useSession();
  const side = useSide();
  const game = useGame();
  // Squad / side markers and people, plus the big game's (game modes, game techs).
  const allMarkers = useMemo(() => (game.markers.length ? [...side.mapMarkers, ...game.markers] : side.mapMarkers), [side.mapMarkers, game.markers]);
  const allMembers = useMemo(
    () => (game.mapMembers.length ? [...side.mapMembers, ...game.mapMembers] : side.mapMembers),
    [side.mapMembers, game.mapMembers]
  );
  const { overlays, focusRequest, requestFocus, viewRequest, requestView, areas, download } = useOverlays();
  const { position: gps, status, heading } = useSelfPosition();
  // A laptop has no GPS (and no location at all offline): use the connected radio's
  // GPS when the device's own fix is missing or stale.
  const radioPos = session.mesh.radio.myPosition;
  const position = useMemo(() => {
    const now = Date.now();
    if (gps && now - gps.timestamp < 60_000) return gps;
    if (radioPos && now - radioPos.at < 10 * 60_000) {
      return { lat: radioPos.lat, lng: radioPos.lng, accuracy: 15, heading, timestamp: radioPos.at };
    }
    return gps;
  }, [gps, radioPos, heading]);
  const mapRef = useRef<TacticalMapHandle>(null);

  const [baseLayer, setBaseLayer] = useState<BaseLayerId>('yandex-sat');
  const [layerPicker, setLayerPicker] = useState(false);
  const [follow, setFollow] = useState(false);
  const [view, setView] = useState<(LatLng & { zoom: number; bounds?: Bounds; snail?: string | null }) | null>(null);
  const [gridSheet, setGridSheet] = useState(false);
  // Map rotation: bearing as turned by hand, or following the compass.
  const [bearing, setBearing] = useState(0);
  const [headingUp, setHeadingUp] = useState(false);
  const night = useNight();
  const [toolsBottom, setToolsBottom] = useState<number | null>(null);
  // Own breadcrumb trail of the last minutes (setting), kept by this phone only.
  const trailMinutes = useTrailMinutes();
  const crumbs = useTrail(position);
  const trailPoints = useMemo(
    () => recentTrail(crumbs, trailMinutes, Date.now()).map((c) => [c.lat, c.lng] as [number, number]),
    [crumbs, trailMinutes]
  );
  const center = view;
  const [offlineSheet, setOfflineSheet] = useState(false);
  // Downloaded areas, for the map page to read tiles from disk.
  const offline = useMemo(
    () =>
      OFFLINE_SUPPORTED && areas.length
        ? {
            root: offlineRootUri(),
            areas: areas.map((a) => ({
              id: a.id,
              layer: a.layer,
              south: a.south,
              west: a.west,
              north: a.north,
              east: a.east,
              minZoom: a.minZoom,
              maxZoom: a.maxZoom,
            })),
          }
        : null,
    [areas]
  );
  const [addAt, setAddAt] = useState<LatLng | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  // Top edge of the bottom HUD, measured, so the map's scale bar sits above it.
  const [hudTop, setHudTop] = useState<number | null>(null);
  const drawingRef = useRef(false);
  drawingRef.current = drawing != null;
  // "Lead me there": a marker or a teammate to walk to.
  const [nav, setNav] = useState<{ type: 'marker' | 'member'; id: string } | null>(null);
  const [arrived, setArrived] = useState(false);
  const speed = useRef(new SpeedTracker());
  useEffect(() => {
    if (position) speed.current.push(position, Date.now());
  }, [position]);

  // Zones that warn: walking into a dead zone or enemy zone, or out of the field.
  const zoneWatcher = useRef(new ZoneWatcher());
  const [zoneAlert, setZoneAlert] = useState<string | null>(null);
  const zoneAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertZones = useMemo<Area[]>(
    () =>
      allMarkers
        .filter((m) => isArea(m.kind) && (m.points?.length ?? 0) >= 3)
        .map((m) => ({ id: m.id, kind: m.kind as AreaKind, label: m.label, points: m.points! })),
    [allMarkers]
  );
  useEffect(() => {
    if (!position) return;
    const alerts = zoneWatcher.current.update(position, alertZones);
    if (!alerts.length) return;
    const a = alerts[alerts.length - 1];
    const name = a.area.label ? ` «${a.area.label}»` : '';
    const text =
      a.type === 'backInBound'
        ? 'Вы снова на полигоне'
        : a.type === 'leaveBound'
          ? `Вы вышли за границу полигона${name}!`
          : a.area.kind === 'area-dead'
            ? `Вы в зоне мертвяка${name}`
            : `Вы в зоне противника${name}!`;
    setZoneAlert(text);
    if (Platform.OS !== 'web') {
      const kind = a.type === 'backInBound' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning;
      Haptics.notificationAsync(kind).catch(() => {});
      // A second buzz for warnings: easy to miss one in the middle of a game.
      if (a.type !== 'backInBound') setTimeout(() => Haptics.notificationAsync(kind).catch(() => {}), 700);
    }
    // A timer of its own: this effect re-runs on every GPS fix.
    if (zoneAlertTimer.current) clearTimeout(zoneAlertTimer.current);
    zoneAlertTimer.current = setTimeout(() => setZoneAlert(null), 10_000);
  }, [position, alertZones]);
  useEffect(() => () => {
    if (zoneAlertTimer.current) clearTimeout(zoneAlertTimer.current);
  }, []);

  // Mortar calculator: fire data from the firing position to the crosshair.
  const mortar = useMortar();
  const [mortarOn, setMortarOn] = useState(false);
  const [mortarSheet, setMortarSheet] = useState(false);
  const calculator = mortarOn && mortar.isMortar;
  // Role changed away from mortar crew: the calculator closes and stays closed.
  useEffect(() => {
    if (!mortar.isMortar) setMortarOn(false);
  }, [mortar.isMortar]);
  const gunAt: LatLng | null = mortar.fixed ?? (position ? { lat: position.lat, lng: position.lng } : null);
  const centeredOnce = useRef(false);

  // The saved layer arrives a moment later; a layer chosen meanwhile wins.
  const layerChosen = useRef(false);
  useEffect(() => {
    loadJson<BaseLayerId>(KEYS.baseLayer, 'yandex-sat').then((id) => {
      if (!layerChosen.current) setBaseLayer(id);
    });
  }, []);

  const chooseLayer = (id: BaseLayerId) => {
    layerChosen.current = true;
    setBaseLayer(id);
    setLayerPicker(false);
    saveJson(KEYS.baseLayer, id);
  };

  // Offline schematic regions: drawn by the «Схема офлайн» layer.
  const regions = useRegions();
  const vectorRegions = useMemo(
    () => regions.local.map((r) => ({ id: r.id, bbox: r.bbox, maxzoom: r.maxzoom })),
    [regions.local]
  );
  const { showRequest } = regions;
  useEffect(() => {
    if (showRequest) chooseLayer('offline-scheme');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRequest]);

  // Publish own position to the team (throttled inside the session), and as a game tech
  // to the whole game.
  const { reportPosition } = session;
  const { reportPosition: reportTech } = game;
  useEffect(() => {
    if (!position) return;
    reportPosition(position);
    reportTech(position);
  }, [position, reportPosition, reportTech]);

  // Jump to the first GPS fix once, unless an imported map is being focused.
  useEffect(() => {
    if (position && !centeredOnce.current && !focusRequest && !viewRequest) {
      centeredOnce.current = true;
      mapRef.current?.setView(position, 16);
    }
  }, [position, focusRequest, viewRequest]);

  // A calendar polygon without a map file: center on its point once.
  useEffect(() => {
    if (!viewRequest) return;
    centeredOnce.current = true;
    mapRef.current?.setView({ lat: viewRequest.lat, lng: viewRequest.lng }, viewRequest.zoom);
    requestView(null);
  }, [viewRequest, requestView]);

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
      !m.gameId &&
      m.kind !== 'arrow' &&
      (m.personal || (m.createdBy === uid && (!m.teamId || m.teamId === teamId))),
    [uid, teamId]
  );
  const onMarkerDragStart = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, []);
  const markersRef = useRef(allMarkers);
  markersRef.current = allMarkers;
  const onMarkerMoved = useCallback(
    (id: string, p: LatLng) => {
      const m = markersRef.current.find((x) => x.id === id);
      if (!m) return;
      moveMarker(m, p).catch((e: Error) => Alert.alert('Не удалось переместить', markerErrorText(e)));
    },
    [moveMarker]
  );
  const onMemberPress = useCallback((id: string) => setSelection({ type: 'member', id }), []);

  const saveMarker = async (
    kind: MarkerKind,
    label: string,
    scope: MarkerScope,
    target: OrderTarget,
    waveMin: number | null,
    zone: HotZone | null,
    territorySize: number
  ) => {
    if (!addAt) return;
    try {
      const at = { label, lat: addAt.lat, lng: addAt.lng };
      // Game modes go to the game, for every side.
      if (kind === 'hotzone' && zone) await game.addZone(addAt, zone, label);
      else if (kind === 'flag') await game.addFlag(addAt, label);
      else if (kind === 'sector') await game.addTerritory(addAt, territorySize);
      else if (isOrder(kind)) await side.placeOrder({ kind, ...at }, target);
      else {
        // The first group leaves when the respawn is set up.
        const wave = waveMin ? { every: waveMin * 60_000, start: Date.now() } : undefined;
        await session.addMarker({ kind, ...at, ...(wave ? { wave } : {}), ...(zone ? { zone } : {}) }, scope);
      }
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
  const visibleMembers = allMembers
    .filter((m) => m.id !== session.uid && m.lat != null && m.lng != null)
    .map((m) => ({ lat: m.lat!, lng: m.lng! }));

  // Votes apply to my own squad's shared markers.
  const canVote = (m: TacMarker) =>
    inTeam && !m.personal && !m.gameId && (!m.teamId || m.teamId === session.teamId);

  const toolbarButtons = 6 + (visibleMembers.length > 0 ? 1 : 0) + (wide ? 1 : 0);
  const toolbarWidth = toolbarButtons * 50 + 8;

  // Landscape top row: [team pill][toolbar].
  const pillW = Math.min(420, width - insets.left - insets.right - 24 - toolbarWidth - 10);
  // Landscape bottom row: [HUD][FAB][locate][status] — buttons are 64 + 52 + 52 plus gaps.
  const actionsW = 64 + 52 + 52 + 14 + (inTeam ? 52 + 14 : 0) + (mortar.isMortar ? 52 + 14 : 0) + 14;

  // Side commander without a squad of their own: the pill shows the side instead.
  const sideOnly = side.isSideCommander && !inTeam;
  const online = allMembers.filter(
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
    selection?.type === 'marker' ? allMarkers.find((m) => m.id === selection.id) : undefined;
  const selectedMember =
    selection?.type === 'member' ? allMembers.find((m) => m.id === selection.id) : undefined;

  // The control zone in play: the newest one, if several.
  const zoneMarker = allMarkers
    .filter((m) => m.zone)
    .reduce<TacMarker | undefined>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), undefined);

  const solution = calculator && gunAt && center ? solve(gunAt, center, mortar.config) : null;

  // Where "lead me there" points, followed live (a teammate keeps moving).
  const navTo = (() => {
    if (!nav) return null;
    if (nav.type === 'marker') {
      const m = allMarkers.find((x) => x.id === nav.id);
      return m ? { lat: m.lat, lng: m.lng, name: m.label || MARKER_KINDS[m.kind].title } : null;
    }
    const m = allMembers.find((x) => x.id === nav.id);
    return m && m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng, name: m.callsign } : null;
  })();
  const navDistance = navTo && position ? distanceMeters(position, navTo) : null;
  const navLat = navTo?.lat;
  const navLng = navTo?.lng;
  const navPoint = useMemo(
    () => (navLat != null && navLng != null ? { lat: navLat, lng: navLng } : null),
    [navLat, navLng]
  );
  // Target gone (marker deleted, teammate left): stop.
  const navLost = nav != null && navTo == null;
  useEffect(() => {
    if (navLost) setNav(null);
  }, [navLost]);
  useEffect(() => {
    if (navDistance == null) return;
    if (!arrived && navDistance <= ARRIVE_M) {
      setArrived(true);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 600);
      }
    } else if (arrived && navDistance > ARRIVE_M * 2) {
      setArrived(false);
    }
  }, [navDistance, arrived]);
  const startNav = (target: { type: 'marker' | 'member'; id: string }) => {
    setMortarOn(false);
    setArrived(false);
    setNav(target);
    setSelection(null);
  };

  // Range circles around every other mortar crew in view; mine (at my firing position)
  // only while the calculator is open, so closing it clears my circle and line of fire.
  const mortarMap = useMemo(() => {
    const guns = allMembers
      .filter((m) => m.role === 'mortar' && m.id !== session.uid && m.lat != null && m.lng != null)
      .map((m) => ({
        id: m.id,
        lat: m.lat!,
        lng: m.lng!,
        r: m.range ?? DEFAULT_RANGE,
        color: m.color ?? session.teamColor,
      }));
    if (calculator && gunAt) guns.push({ id: 'self', ...gunAt, r: mortar.config.range, color: session.teamColor });
    if (!guns.length) return null;
    return { guns, aim: calculator && gunAt ? { ...gunAt, r: mortar.config.range } : null };
    // gunAt is rebuilt every render; its coordinates are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMembers, session.uid, session.teamColor, mortar.config.range, calculator, gunAt?.lat, gunAt?.lng]);

  const banner =
    status === 'denied' && !radioPos
      ? Platform.OS === 'web'
        ? 'Нет геолокации: разрешите её браузеру (значок слева в адресной строке) или подключите рацию с GPS'
        : 'Нет доступа к геолокации — разрешите его в настройках телефона'
      : zoneAlert
        ? zoneAlert
        : inTeam && session.teamError
        ? session.teamError
        : null;

  // The bottom-right column (its height counted, not measured: as a row it'd measure
  // differently and flip back) must stay under the toolbar.
  const actionCount = (inTeam ? 1 : 0) + (mortar.isMortar ? 1 : 0) + 2;
  const columnTop = height - (insets.bottom + 108) - (actionCount * 52 + 64 + actionCount * 14);
  const columnHitsToolbar = toolsBottom != null && columnTop < toolsBottom + 10;

  const hqGroups: HqGroup[] = game.isTech
    ? game.roster
    : side.isSideCommander && side.side
      ? [
          {
            id: side.side.id,
            name: side.side.name,
            color: session.teamColor,
            squads: side.squads.map((sq) => ({ id: sq.id, name: sq.name, color: sq.displayColor, members: sq.members })),
          },
        ]
      : inTeam
        ? [
            {
              id: session.teamId ?? 'team',
              name: session.team?.name ?? 'Отряд',
              color: session.teamColor,
              squads: [{ id: session.teamId ?? 'team', name: session.team?.name ?? 'Отряд', color: session.teamColor, members: session.members }],
            },
          ]
        : [];

  return (
    <View style={styles.hqRow}>
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
        selfTech={game.isTech}
        grid={session.gridMode}
        gridOrigin={session.gridOrigin}
        headingUp={headingUp}
        night={night}
        navTarget={navPoint}
        trail={trailPoints}
        onBearingChanged={setBearing}
        onHeadingUpChanged={setHeadingUp}
        topInset={landscape ? insets.top + 60 : pillTop + 58}
        follow={follow}
        members={allMembers}
        selfId={session.uid}
        teamColor={session.teamColor}
        ownerId={session.team?.ownerId ?? null}
        markers={allMarkers}
        overlays={overlays}
        focusOverlay={focusRequest}
        onFocusHandled={onFocusHandled}
        onLongPress={openAdd}
        onMarkerPress={onMarkerPress}
        isMovable={isMovable}
        onMarkerDragStart={onMarkerDragStart}
        onMarkerMoved={onMarkerMoved}
        onMemberPress={onMemberPress}
        onViewChanged={setView}
        offline={offline}
        vectorRegions={vectorRegions}
        onFollowChanged={setFollow}
        onOverlayError={onOverlayError}
        bottomInset={hudTop == null ? undefined : height - hudTop + 6}
        drawing={drawing && { ...drawing, area: drawing.kind === 'arrow' || drawing.kind === 'ball' ? null : drawing.kind }}
        mortar={mortarMap}
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
            {session.mesh.radio.device && inTeam && (
              <View style={[styles.meshChip, session.mesh.radio.squadReady && styles.meshChipOn]}>
                <Icon
                  name="radio-handheld"
                  size={13}
                  color={session.mesh.radio.squadReady ? C.info : session.mesh.radio.state === 'off' ? C.danger : C.faint}
                />
                <Text style={[styles.meshText, session.mesh.radio.squadReady && { color: C.info }]}>
                  {session.mesh.radioPeers}
                </Text>
              </View>
            )}
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
      <View
        onLayout={(e) => setToolsBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        style={[styles.tools, { top: landscape ? insets.top + 10 : pillTop + 64, right: 12 + insets.right }]}
      >
        <Glass radius={R.lg} style={[styles.toolbar, landscape && styles.toolbarRow]}>
          <ToolbarButton icon="layers-triple-outline" label="Подложка" onPress={() => setLayerPicker(true)} />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton
            icon={download ? 'cloud-sync-outline' : 'cloud-download-outline'}
            label="Карта без интернета"
            active={download != null}
            onPress={() => setOfflineSheet(true)}
          />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton icon="map-plus" label="Карты полигона" onPress={() => router.push('/maps')} />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <ToolbarButton
            icon={session.gridMode === 'snail' ? 'grid-large' : session.gridMode === 'utm' ? 'grid' : 'grid-off'}
            label="Сетка координат"
            active={session.gridMode !== 'off'}
            onPress={() => setGridSheet(true)}
          />
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          <Pressable
            accessibilityLabel={headingUp ? 'Карта по компасу, нажмите для севера вверху' : 'Поворот карты'}
            hitSlop={4}
            onPress={() => {
              tap();
              if (headingUp) {
                setHeadingUp(false);
                mapRef.current?.resetNorth();
              } else if (Math.abs(((bearing + 180) % 360) - 180) > 1) {
                mapRef.current?.resetNorth();
              } else if (heading == null) {
                Alert.alert('Нет компаса', 'Компас телефона ещё не дал направление');
              } else {
                setFollow(true);
                mapRef.current?.centerOnSelf();
                setHeadingUp(true);
              }
            }}
            style={({ pressed }) => [styles.toolbarButton, pressed && { opacity: 0.6 }]}
          >
            {/* The needle points north on screen. */}
            <View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
              <Icon name="navigation" size={22} color={headingUp ? C.accent : C.text} />
            </View>
          </Pressable>
          <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
          {wide && (
            <>
              <ToolbarButton icon="view-dashboard-outline" label="Штаб" active={hqOn} onPress={toggleHq} />
              <View style={[styles.toolbarSep, landscape && styles.toolbarSepRow]} />
            </>
          )}
          <ToolbarButton
            icon="draw"
            label="Нарисовать стрелку"
            onPress={() => {
              setFollow(false);
              setDrawing({ kind: 'arrow', color: ARROW_COLORS[0], points: [], scope: 'team' });
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

      {zoneMarker && !drawing && (
        <ZoneChip
          marker={zoneMarker}
          self={position}
          score={zoneMarker.gameId ? <GameScore compact /> : null}
          style={
            landscape
              ? { top: insets.top + 60, left: 12 + insets.left }
              : { top: pillTop + 64 + (banner ? 56 : 0), left: 12 + insets.left }
          }
          onPress={() => setSelection({ type: 'marker', id: zoneMarker.id })}
        />
      )}
      {/* Big game without a control zone: the match clock and score on their own. */}
      {game.game && !(zoneMarker?.gameId) && !drawing && (
        <Pressable
          onPress={() => router.push('/game')}
          style={[
            styles.zoneChipWrap,
            landscape
              ? { top: insets.top + 60, left: 12 + insets.left }
              : { top: pillTop + 64 + (banner ? 56 : 0), left: 12 + insets.left },
          ]}
        >
          <Glass radius={R.md} style={[styles.zoneChip, { maxWidth: 260 }]}>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text style={styles.zoneChipTitle} numberOfLines={1}>
                {game.game.name}
              </Text>
              <GameScore compact />
            </View>
          </Glass>
        </Pressable>
      )}

      {drawing && (
        <DrawBar
          drawing={drawing}
          inTeam={inTeam}
          sides={game.isTech ? game.sides : []}
          bottom={insets.bottom + 12}
          left={12 + insets.left}
          right={12 + insets.right}
          onChange={setDrawing}
          onCancel={() => setDrawing(null)}
          onDone={async () => {
            const pts = drawing.points;
            try {
              if (drawing.kind === 'ball') {
                if (!drawing.sideId) throw new Error('Выберите сторону, чей это мяч');
                await game.addBall(drawing.sideId, pts);
              } else if (drawing.kind === 'arrow') {
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
              } else {
                const c = centroid(pts);
                await session.addMarker(
                  { kind: drawing.kind, label: '', lat: c.lat, lng: c.lng, points: pts },
                  inTeam ? drawing.scope : 'personal'
                );
              }
              setDrawing(null);
            } catch (e) {
              Alert.alert('Не удалось сохранить', (e as Error).message);
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
          {
            bottom:
              (calculator || nav) && !landscape && hudTop != null
                ? height - hudTop + 12
                : insets.bottom + (landscape ? 12 : 108),
            right: 12 + insets.right,
          },
          // A tall bottom panel, or a short screen, leaves no room for a column under the
          // toolbar: a row then.
          (landscape || calculator || nav || columnHitsToolbar) && { flexDirection: 'row-reverse' },
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
        {mortar.isMortar && (
          <GlassButton
            icon="bullseye-arrow"
            label="Миномётный калькулятор"
            size={52}
            active={calculator}
            onPress={() => {
              if (!calculator) {
                setFollow(false);
                setNav(null);
              }
              setMortarOn(!calculator);
            }}
          />
        )}
        <GlassButton
          icon="camera"
          label="Фото с привязкой"
          size={52}
          onPress={async () => {
            if (!position) {
              Alert.alert('Нет GPS', 'Фото привязывается к вашей позиции — дождитесь координат');
              return;
            }
            // Where I stand and look when pressing, not after the camera closes.
            const at = { lat: position.lat, lng: position.lng, heading };
            try {
              const data = await takePhoto();
              if (!data) return;
              await session.addPhotoMarker({ ...at, data, label: '' }, inTeam ? 'team' : 'personal');
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            } catch (e) {
              Alert.alert('Фото не получилось', (e as Error).message);
            }
          }}
        />
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

      {nav && navTo && !drawing && (
        <View
          onLayout={(e) => setHudTop(e.nativeEvent.layout.y)}
          style={[
            styles.mortarWrap,
            { bottom: insets.bottom + 12, left: 12 + insets.left, right: 12 + insets.right },
            landscape && { right: undefined, width: Math.min(460, width / 2 - 12 - insets.left - 30) },
          ]}
        >
          <NavPanel
            name={navTo.name}
            distance={navDistance ?? 0}
            bearing={position ? bearingDegrees(position, navTo) : 0}
            heading={heading}
            mapBearing={bearing}
            eta={navDistance != null ? formatEta(etaSeconds(navDistance, speed.current.speed())) : '—'}
            arrived={arrived}
            compact={landscape}
            onClose={() => setNav(null)}
          />
        </View>
      )}

      {calculator && !nav && !drawing && (
        <View
          onLayout={(e) => setHudTop(e.nativeEvent.layout.y)}
          style={[
            styles.mortarWrap,
            { bottom: insets.bottom + 12, left: 12 + insets.left, right: 12 + insets.right },
            // Landscape: keep to the left half so the crosshair in the middle stays clear.
            landscape && { right: undefined, width: Math.min(460, width / 2 - 12 - insets.left - 30) },
          ]}
        >
          <MortarPanel
            solution={solution}
            heading={heading}
            range={mortar.config.range}
            fixed={mortar.fixed != null}
            compact={landscape}
            onCorrect={(longer, right) => {
              if (gunAt && center) mapRef.current?.setView(correct(gunAt, center, longer, right));
            }}
            onFixHere={() => center && mortar.setFixed({ lat: center.lat, lng: center.lng })}
            onUseGps={() => mortar.setFixed(null)}
            onSettings={() => setMortarSheet(true)}
            onClose={() => setMortarOn(false)}
          />
        </View>
      )}

      {/* Bottom HUD */}
      <Glass
        radius={R.lg}
        onLayout={(e) => setHudTop(e.nativeEvent.layout.y)}
        style={[
          (drawing || calculator || nav) && { display: 'none' },
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
          {!landscape && <Text style={eyebrow}>{center?.snail ? 'Квадрат' : 'Перекрестие'}</Text>}
          <Text style={[styles.hudValue, landscape && styles.hudValueCompact]} numberOfLines={1} adjustsFontSizeToFit>
            {center?.snail ? `${center.snail} по улитке` : center ? formatCoords(center) : '—'}
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
        <View style={styles.hudSep} />
        <View>
          {!landscape && <Text style={eyebrow}>Курс</Text>}
          <Text style={[styles.hudValue, landscape && styles.hudValueCompact]} numberOfLines={1}>
            {heading != null ? `${Math.round(heading)}°` : '—'}
          </Text>
        </View>
        <View style={[styles.gps, landscape && styles.gpsCompact]}>
          <View style={[styles.gpsDot, { backgroundColor: gpsColor(position?.accuracy) }]} />
          <Text style={styles.gpsText}>
            {position?.accuracy != null ? `±${Math.round(position.accuracy)}м` : 'GPS'}
          </Text>
        </View>
      </Glass>

      <MortarSheet
        visible={mortarSheet}
        config={mortar.config}
        aimDistance={gunAt && center ? distanceMeters(gunAt, center) : null}
        onChange={mortar.setConfig}
        onClose={() => setMortarSheet(false)}
      />
      <GridSheet
        visible={gridSheet}
        mode={session.gridMode}
        origin={session.gridOrigin}
        canPlace={!inTeam || session.canCommand}
        onMode={(m) => session.setGridMode(m)}
        onPlace={() => {
          if (!center) return;
          session
            .setGridOrigin({ lat: center.lat, lng: center.lng })
            .catch((e: Error) => Alert.alert('Не удалось', e.message));
        }}
        onReset={() => session.setGridOrigin(null).catch((e: Error) => Alert.alert('Не удалось', e.message))}
        onClose={() => setGridSheet(false)}
      />
      <OfflineSheet visible={offlineSheet} onClose={() => setOfflineSheet(false)} layer={baseLayer} view={view} />
      <RegionPrompt position={position} layer={baseLayer} />

      <AddMarkerModal
        at={addAt}
        inTeam={inTeam}
        canCommand={session.canCommand || side.isSideCommander}
        isTech={game.isTech}
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
        stats={
          selectedMarker
            ? [
                ...vectorStats(position, selectedMarker, heading),
                ...(mortar.isMortar && gunAt
                  ? [{ label: 'Прицел миномёта', value: fireText(solve(gunAt, selectedMarker, mortar.config)) }]
                  : []),
              ]
            : []
        }
      >
        {selectedMarker?.kind === 'photo' && (
          <PhotoView marker={selectedMarker} teamId={selectedMarker.teamId ?? session.teamId} />
        )}
        {selectedMarker && !selectedMarker.points && position && (
          <Button
            title="Вести сюда"
            icon="navigation-variant"
            onPress={() => startNav({ type: 'marker', id: selectedMarker.id })}
          />
        )}
        {selectedMarker && mortar.isMortar && selectedMarker.kind !== 'arrow' && (
          <Button
            title="Навести миномёт"
            icon="bullseye-arrow"
            kind="secondary"
            onPress={() => {
              setFollow(false);
              setNav(null);
              setMortarOn(true);
              mapRef.current?.setView({ lat: selectedMarker.lat, lng: selectedMarker.lng });
              setSelection(null);
            }}
          />
        )}
        {selectedMarker && (selectedMarker.kind === 'respawn' || selectedMarker.kind === 'deadzone') && !selectedMarker.personal && (
          <WavePanel
            marker={selectedMarker}
            canEdit={session.canCommand && (!selectedMarker.teamId || selectedMarker.teamId === session.teamId)}
            onSet={(w) => session.setMarkerWave(selectedMarker, w)}
          />
        )}
        {selectedMarker?.zone && (
          <ZonePanel
            marker={selectedMarker}
            self={position}
            canEdit={
              selectedMarker.gameId
                ? game.isTech
                : session.canCommand && (!selectedMarker.teamId || selectedMarker.teamId === session.teamId)
            }
            onSet={(z) =>
              selectedMarker.gameId
                ? game.setZone(selectedMarker, z).catch((e: Error) => Alert.alert('Ошибка', e.message))
                : session.setMarkerZone(selectedMarker, z)
            }
            score={selectedMarker.gameId ? <GameScore /> : null}
          />
        )}
        {selectedMarker && (selectedMarker.kind === 'flag' || selectedMarker.kind === 'sector' || selectedMarker.kind === 'ball') && selectedMarker.gameId && (
          <HoldPanel marker={selectedMarker} self={position} />
        )}
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
        {selectedMarker?.gameId && game.isTech && (
          <Button
            title="Убрать из игры"
            kind="danger"
            icon="trash-can-outline"
            onPress={() =>
              game
                .deleteMarker(selectedMarker)
                .then(() => setSelection(null))
                .catch((e: Error) => Alert.alert('Не удалось удалить', e.message))
            }
          />
        )}
        {selectedMarker && !selectedMarker.gameId && side.canDelete(selectedMarker) && (
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
            selectedMember.mapLabel ? `командир отряда «${selectedMember.mapLabel}»` : null,
            ROLES[selectedMember.role].title,
            selectedMember.status !== 'alive' ? STATUSES[selectedMember.status].title.toUpperCase() : null,
            selectedMember.canCommand || selectedMember.id === session.team?.ownerId ? 'отдаёт приказы' : null,
            selectedMember.updatedAt ? `на связи ${timeAgo(selectedMember.updatedAt)}` : null,
            powerText(selectedMember),
          ]
            .filter(Boolean)
            .join(' · ')
        }
        stats={
          selectedMember && selectedMember.lat != null && selectedMember.lng != null
            ? vectorStats(position, { lat: selectedMember.lat, lng: selectedMember.lng }, heading)
            : []
        }
      >
        {selectedMember && selectedMember.lat != null && position && selectedMember.id !== session.uid && (
          <Button
            title="Вести к бойцу"
            icon="navigation-variant"
            onPress={() => startNav({ type: 'member', id: selectedMember.id })}
          />
        )}
      </InfoSheet>

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
                  // Nothing downloaded yet: the schematic layer would be empty.
                  if (l.id === 'offline-scheme' && regions.local.length === 0) {
                    setLayerPicker(false);
                    router.push('/regions');
                    return;
                  }
                  chooseLayer(l.id);
                }}
                style={[styles.layerCard, selected && styles.layerCardSelected]}
              >
                <View style={[styles.layerIcon, selected && { backgroundColor: C.accent }]}>
                  <Icon name={l.icon} size={22} color={selected ? C.accentInk : C.text} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.layerTitle}>{l.title}</Text>
                  <Text style={styles.layerProvider}>
                    {l.id === 'offline-scheme' && regions.local.length === 0 ? 'скачать регион →' : l.provider}
                  </Text>
                </View>
                {selected && <Icon name="check-circle" size={20} color={C.accent} />}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
      {hqWidth > 0 && (
        <HqPanel
          width={hqWidth}
          groups={hqGroups}
          markers={allMarkers}
          sideName={game.sideName}
          onFocus={(p, memberId) => {
            setFollow(false);
            mapRef.current?.setView(p, 17);
            if (memberId && allMembers.some((m) => m.id === memberId)) setSelection({ type: 'member', id: memberId });
          }}
        />
      )}
    </View>
  );
}

type Drawing = {
  kind: 'arrow' | AreaKind | 'ball';
  color: string;
  points: LatLng[];
  scope: MarkerScope;
  /** Football: whose ball this arrow is for. */
  sideId?: string;
};

const ARROW_COLORS = ['#FFC83D', '#FF4D4D', '#3D9BFF', '#4ADE80', '#F5F5F5'];

const DRAW_KINDS: { kind: Drawing['kind']; label: string }[] = [
  { kind: 'arrow', label: 'Стрелка' },
  { kind: 'area-dead', label: 'Мертвяк' },
  { kind: 'area-enemy', label: 'Противник' },
  { kind: 'area-bound', label: 'Граница' },
];

/** Controls shown while drawing an arrow: color, audience, undo, cancel, done. */
function DrawBar({
  drawing,
  inTeam,
  sides,
  bottom,
  left,
  right,
  onChange,
  onCancel,
  onDone,
}: {
  drawing: Drawing;
  inTeam: boolean;
  /** Game tech: the game's sides, for football ball arrows. */
  sides: GameSide[];
  bottom: number;
  left: number;
  right: number;
  onChange: (d: Drawing) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const n = drawing.points.length;
  const ball = drawing.kind === 'ball';
  const area = drawing.kind !== 'arrow' && !ball;
  const kinds = sides.length ? [...DRAW_KINDS, { kind: 'ball' as const, label: 'Мяч' }] : DRAW_KINDS;
  return (
    <Glass radius={R.lg} style={[styles.drawBar, { bottom, left, right }]}>
      <View style={styles.drawRow}>
        {kinds.map((k) => {
          const on = k.kind === drawing.kind;
          return (
            <Pressable
              key={k.kind}
              onPress={() => {
                tap();
                onChange({
                  ...drawing,
                  kind: k.kind,
                  color:
                    k.kind === 'ball'
                      ? (sides[0]?.color ?? '#F2F2F2')
                      : k.kind === 'arrow'
                        ? ARROW_COLORS[0]
                        : MARKER_KINDS[k.kind].color,
                  sideId: k.kind === 'ball' ? sides[0]?.id : undefined,
                });
              }}
              style={[styles.drawKind, on && styles.drawKindOn]}
            >
              <Text style={[styles.drawScopeText, on && { color: C.accentInk }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.drawHeader}>
        <Icon
          name={area ? MARKER_KINDS[drawing.kind as AreaKind].icon : ball ? 'soccer' : 'draw'}
          size={20}
          color={drawing.color}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.drawTitle}>
            {area ? MARKER_KINDS[drawing.kind as AreaKind].title : ball ? 'Путь мяча' : 'Стрелка'} · {n}{' '}
            {n === 1 ? 'точка' : n >= 2 && n <= 4 ? 'точки' : 'точек'}
          </Text>
          <Text style={styles.drawHint} numberOfLines={1}>
            {area
              ? drawing.kind === 'area-bound'
                ? 'Обойдите углы полигона: выход за край — вибрация'
                : 'Обведите зону по углам: вход в неё — вибрация'
              : ball
                ? 'От старта мяча к базе соперника'
                : 'Нажимайте по карте от начала к острию'}
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
        {ball &&
          sides.map((sd) => (
            <Pressable
              key={sd.id}
              onPress={() => {
                tap();
                onChange({ ...drawing, color: sd.color, sideId: sd.id });
              }}
              style={[styles.drawScope, sd.id === drawing.sideId && { borderColor: sd.color, borderWidth: 2 }]}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sd.color }} />
              <Text style={styles.drawScopeText}>Мяч: {sd.name}</Text>
            </Pressable>
          ))}
        {!area &&
          !ball &&
          ARROW_COLORS.map((c) => (
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
        {inTeam && !ball && (
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
          disabled={n < (area ? 3 : 2)}
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
  hqRow: { flex: 1, flexDirection: 'row', backgroundColor: C.bg },

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
  zoneChipWrap: { position: 'absolute' },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 90, 31, 0.45)',
  },
  zoneChipTitle: { color: C.text, fontSize: 14, fontFamily: F.semibold },
  zoneChipSub: { color: C.dim, fontSize: 11, fontFamily: F.mono },

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
    gap: 10,
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
  mortarWrap: { position: 'absolute', maxWidth: 560 },
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
  drawKind: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.elevated,
    justifyContent: 'center',
  },
  drawKindOn: { backgroundColor: C.accent, borderColor: C.accent },
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

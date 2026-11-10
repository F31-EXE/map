import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { formatClock } from '../lib/geo';
import { isArea } from '../lib/geofence';
import { BALL_RADIUS, TECH_COLOR } from '../lib/gameModes';
import { isAdminKind, isOrder, MARKER_KINDS } from '../lib/markerKinds';
import { ROLES, type RoleId } from '../lib/roles';
import { readRange } from '../services/vectorRegions';
import type { Bounds } from '../lib/tiles';
import type { GridMode, LatLng, Member, OverlayMeta, SelfPosition, TacMarker } from '../lib/types';
import { loadOverlayPayload } from '../services/overlays';
import { MapFrame, type MapFrameHandle } from './MapFrame';

export type BaseLayerId = 'yandex-sat' | 'yandex-hybrid' | 'yandex-map' | 'esri-sat' | 'osm' | 'topo' | 'offline-scheme';

export const BASE_LAYERS: {
  id: BaseLayerId;
  title: string;
  provider: string;
  icon: 'satellite-variant' | 'layers-outline' | 'map-outline' | 'earth' | 'terrain' | 'map-legend' | 'map-check-outline';
}[] = [
  { id: 'yandex-sat', title: 'Спутник', provider: 'Яндекс', icon: 'satellite-variant' },
  { id: 'yandex-hybrid', title: 'Гибрид', provider: 'Яндекс', icon: 'layers-outline' },
  { id: 'yandex-map', title: 'Схема', provider: 'Яндекс', icon: 'map-outline' },
  { id: 'esri-sat', title: 'Спутник', provider: 'Esri', icon: 'earth' },
  { id: 'topo', title: 'Топо', provider: 'OpenTopoMap', icon: 'terrain' },
  { id: 'osm', title: 'Схема', provider: 'OpenStreetMap', icon: 'map-legend' },
  { id: 'offline-scheme', title: 'Схема офлайн', provider: 'скачанные регионы', icon: 'map-check-outline' },
];

/** Positions older than this are drawn faded. */
export const STALE_MS = 2 * 60_000;

export type TacticalMapHandle = {
  centerOnSelf: () => void;
  fitOverlay: (id: string) => void;
  setView: (p: LatLng, zoom?: number) => void;
  fitPoints: (points: LatLng[]) => void;
  /** Turns the map back to north-up. */
  resetNorth: () => void;
};

type Props = {
  ref?: Ref<TacticalMapHandle>;
  baseLayer: BaseLayerId;
  self: SelfPosition | null;
  /** Own role and color for the self marker. */
  selfRole?: RoleId;
  selfColor?: string;
  /** I'm a game tech: the self marker is an orange diamond. */
  selfTech?: boolean;
  follow: boolean;
  /** Grid overlay: UTM squares or the 500 m snail grid. */
  grid?: GridMode;
  /** Snail grid: NW corner of square А1 (null: counted from 5 km blocks). */
  gridOrigin?: LatLng | null;
  /** Turn the map with the compass so what's ahead is at the top. */
  headingUp?: boolean;
  /** Night mode: dim red map. */
  night?: boolean;
  /** "Lead me there": a line from me to this point. */
  navTarget?: LatLng | null;
  /** Own breadcrumb trail, oldest first. */
  trail?: [number, number][] | null;
  /** Map bearing in degrees (0 = north up), as the user turns it. */
  onBearingChanged?: (bearing: number) => void;
  /** Heading-up switched itself off (the user turned the map by hand). */
  onHeadingUpChanged?: (on: boolean) => void;
  /** Downloaded base-layer areas (native only): tiles load from disk first. */
  offline?: { root: string; areas: unknown[] } | null;
  /** Downloaded schematic regions for the «Схема офлайн» layer (native only). */
  vectorRegions?: { id: string; bbox: number[]; maxzoom: number }[];
  members: Member[];
  /** Own uid — excluded from the members layer (drawn as `self`). */
  selfId: string | null;
  /** Every teammate is drawn in the team color. */
  teamColor: string;
  /** Team creator: shown with the command badge like granted commanders. */
  ownerId: string | null;
  markers: TacMarker[];
  overlays: OverlayMeta[];
  /** Overlay to zoom to as soon as it is drawn; `onFocusHandled` fires afterwards. */
  focusOverlay?: string | null;
  onFocusHandled?: () => void;
  onLongPress?: (p: LatLng) => void;
  onMarkerPress?: (id: string) => void;
  /** Markers the user may pick up with a long press and drag. */
  isMovable?: (m: TacMarker) => boolean;
  onMarkerDragStart?: (id: string) => void;
  onMarkerMoved?: (id: string, p: LatLng) => void;
  onMemberPress?: (id: string) => void;
  onViewChanged?: (p: LatLng & { zoom: number; bounds?: Bounds; snail?: string | null }) => void;
  onFollowChanged?: (follow: boolean) => void;
  onOverlayError?: (id: string, message: string) => void;
  /** Game analysis overlay: tracks as [lat, lng] segments, heat as [lat, lng] samples. */
  analysis?: {
    tracks: { color: string; segments: [number, number][][] }[];
    heat: [number, number][];
    showTracks: boolean;
    showHeat: boolean;
  } | null;
  /**
   * Mortar range circles, and in calculator mode the firing position whose line of fire
   * follows the crosshair (`r`: maximum range, the line turns red past it).
   */
  mortar?: {
    guns: { id: string; lat: number; lng: number; r: number; color: string }[];
    aim: { lat: number; lng: number; r: number } | null;
  } | null;
  /** Pixels at the bottom covered by native panels (scale bar goes above). */
  bottomInset?: number;
  /** Pixels at the top covered by native panels (grid labels go below). */
  topInset?: number;
  /** Arrow drawing mode: taps add points (reported via onDrawChanged). */
  drawing?: { color: string; points: LatLng[]; area?: string | null } | null;
  onDrawChanged?: (points: LatLng[]) => void;
};

type Outgoing = { type: string; payload?: unknown };

export function TacticalMap(props: Props) {
  const frameRef = useRef<MapFrameHandle>(null);
  // Bumped every time the page (re)loads, so all effects re-send their state.
  const [generation, setGeneration] = useState(0);
  const sentOverlays = useRef(new Map<string, boolean>());
  const loadedOverlays = useRef(new Set<string>());
  const pendingFocus = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const send = useCallback((msg: Outgoing) => {
    frameRef.current?.post(msg);
  }, []);

  // Commands from the screen (e.g. "center on the first GPS fix") can come before the
  // page has loaded; hold them until it's ready instead of dropping them.
  const readyRef = useRef(false);
  const queued = useRef<Outgoing[]>([]);
  const command = useCallback(
    (msg: Outgoing) => {
      if (readyRef.current) send(msg);
      else queued.current.push(msg);
    },
    [send]
  );

  useImperativeHandle(
    props.ref,
    () => ({
      centerOnSelf: () => command({ type: 'centerOnSelf' }),
      fitOverlay: (id) => command({ type: 'fitOverlay', payload: { id } }),
      setView: (p, zoom) => command({ type: 'setView', payload: { ...p, zoom } }),
      fitPoints: (points) => command({ type: 'fitPoints', payload: points }),
      resetNorth: () => command({ type: 'setBearing', payload: { bearing: 0 } }),
    }),
    [command]
  );

  // Re-evaluate member staleness even when nothing else changes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const ready = generation > 0;
  readyRef.current = ready;

  useEffect(() => {
    if (ready) send({ type: 'setBaseLayer', payload: { id: props.baseLayer } });
  }, [ready, generation, props.baseLayer, send]);

  useEffect(() => {
    if (!ready) return;
    const { self, selfRole, selfColor, selfTech } = props;
    send({
      type: 'setSelf',
      payload: self && {
        ...self,
        rolePath: selfRole && !selfTech ? ROLES[selfRole].path : null,
        color: selfTech ? TECH_COLOR : (selfColor ?? null),
        tech: Boolean(selfTech),
      },
    });
  }, [ready, generation, props.self, props.selfRole, props.selfColor, props.selfTech, send]);

  const { grid, gridOrigin, headingUp } = props;
  const originLat = gridOrigin?.lat;
  const originLng = gridOrigin?.lng;
  useEffect(() => {
    if (!ready) return;
    const origin = originLat != null && originLng != null ? { lat: originLat, lng: originLng } : null;
    send({ type: 'setGrid', payload: { mode: grid ?? 'off', origin } });
  }, [ready, generation, grid, originLat, originLng, send]);

  useEffect(() => {
    if (ready) send({ type: 'setHeadingUp', payload: { on: Boolean(headingUp) } });
  }, [ready, generation, headingUp, send]);

  const { night, navTarget, trail } = props;
  useEffect(() => {
    if (ready) send({ type: 'setTrail', payload: { points: trail ?? [] } });
  }, [ready, generation, trail, send]);
  useEffect(() => {
    if (ready) send({ type: 'setNav', payload: navTarget ?? null });
  }, [ready, generation, navTarget, send]);
  useEffect(() => {
    if (ready) send({ type: 'setNight', payload: { on: Boolean(night) } });
  }, [ready, generation, night, send]);

  const { offline, vectorRegions } = props;
  useEffect(() => {
    if (ready) send({ type: 'setOffline', payload: offline ?? null });
  }, [ready, generation, offline, send]);
  useEffect(() => {
    if (ready) send({ type: 'setVectorRegions', payload: vectorRegions ?? [] });
  }, [ready, generation, vectorRegions, send]);

  useEffect(() => {
    if (ready) send({ type: 'setFollow', payload: { follow: props.follow } });
  }, [ready, generation, props.follow, send]);

  useEffect(() => {
    if (!ready) return;
    const list = props.members
      .filter((m) => m.id !== props.selfId && m.lat != null && m.lng != null)
      .map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        callsign: m.mapLabel ?? m.callsign,
        color: m.tech ? TECH_COLOR : (m.color ?? props.teamColor),
        rolePath: ROLES[m.role].path,
        roleTitle: m.tech ? 'Игротех' : m.mapLabel ? null : ROLES[m.role].title,
        commander: !m.tech && (m.leader ?? (m.canCommand || m.id === props.ownerId)),
        tech: Boolean(m.tech),
        heading: m.heading,
        status: m.status,
        stale: !m.updatedAt || now - m.updatedAt > STALE_MS,
      }));
    send({ type: 'setMembers', payload: list });
  }, [ready, generation, props.members, props.selfId, props.teamColor, props.ownerId, now, send]);

  const { isMovable } = props;
  useEffect(() => {
    if (!ready) return;
    const list = props.markers.map((m) => {
      const k = MARKER_KINDS[m.kind] ?? MARKER_KINDS.note;
      return {
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        label: m.label,
        path: k.path,
        color: m.color ?? k.color,
        points: m.points,
        area: isArea(m.kind) || m.kind === 'sector',
        kind: m.kind,
        title: m.kind === 'sector' ? sectorTitle(m) : m.label || k.title,
        dir: m.kind === 'photo' && m.heading != null ? m.heading : null,
        order: isOrder(m.kind),
        admin: isAdminKind(m.kind) || m.kind === 'hotzone',
        movable: Boolean(isMovable?.(m)),
        wave: m.wave ?? null,
        zone: m.zone ?? null,
        ball:
          m.kind === 'ball'
            ? { lat: m.lat, lng: m.lng, r: BALL_RADIUS, push: m.ball?.push ?? 0, goal: Boolean(m.ball?.goal) }
            : null,
        personal: Boolean(m.personal),
        time: formatClock(m.createdAt),
      };
    });
    send({ type: 'setMarkers', payload: list });
  }, [ready, generation, props.markers, isMovable, send]);

  const analysis = props.analysis;
  useEffect(() => {
    if (ready) send({ type: 'setAnalysis', payload: analysis ?? null });
  }, [ready, generation, analysis, send]);

  const mortar = props.mortar;
  useEffect(() => {
    if (ready) send({ type: 'setMortar', payload: mortar ?? null });
  }, [ready, generation, mortar, send]);

  const { bottomInset, topInset } = props;
  useEffect(() => {
    if (ready && bottomInset != null) send({ type: 'setInsets', payload: { bottom: bottomInset, top: topInset ?? 0 } });
  }, [ready, generation, bottomInset, topInset, send]);

  const drawing = props.drawing;
  useEffect(() => {
    if (!ready) return;
    send({
      type: 'setDraw',
      payload: drawing ? { on: true, color: drawing.color, points: drawing.points, area: drawing.area ?? null } : null,
    });
  }, [ready, generation, drawing, send]);

  const { onOverlayError } = props;
  useEffect(() => {
    if (!ready) return;
    const sent = sentOverlays.current;
    const wanted = new Map(props.overlays.map((o) => [o.id, o]));
    for (const id of [...sent.keys()]) {
      if (!wanted.has(id)) {
        send({ type: 'removeOverlay', payload: { id } });
        sent.delete(id);
        loadedOverlays.current.delete(id);
      }
    }
    for (const o of props.overlays) {
      if (!sent.has(o.id)) {
        sent.set(o.id, o.visible);
        loadOverlayPayload(o)
          .then((payload) => send({ type: 'addOverlay', payload: { id: o.id, visible: o.visible, ...payload } }))
          .catch((e: Error) => onOverlayError?.(o.id, e.message));
      } else if (sent.get(o.id) !== o.visible) {
        sent.set(o.id, o.visible);
        send({ type: 'setOverlayVisible', payload: { id: o.id, visible: o.visible } });
      }
    }
  }, [ready, generation, props.overlays, send, onOverlayError]);

  const { focusOverlay, onFocusHandled } = props;
  useEffect(() => {
    if (!ready || !focusOverlay) return;
    if (loadedOverlays.current.has(focusOverlay)) {
      send({ type: 'fitOverlay', payload: { id: focusOverlay } });
      onFocusHandled?.();
    } else {
      pendingFocus.current = focusOverlay;
    }
  }, [ready, generation, focusOverlay, onFocusHandled, send]);

  // Declared after the other effects so it runs after them, so layers and markers are in place first.
  useEffect(() => {
    if (!ready || !queued.current.length) return;
    const list = queued.current;
    queued.current = [];
    list.forEach(send);
  }, [ready, generation, send]);

  const onMessage = useCallback(
    (data: string) => {
      let msg: { type: string; payload: any };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      const p = msg.payload;
      switch (msg.type) {
        case 'pmRead': {
          // The schematic map reads its region files a byte range at a time (sync on
          // phones, async in the browser).
          new Promise<string>((resolve) => resolve(readRange(String(p.id), Number(p.offset), Number(p.length))))
            .then((b64) => send({ type: 'pmData', payload: { k: p.k, b64 } }))
            .catch((e: Error) => send({ type: 'pmData', payload: { k: p.k, error: e.message || 'read failed' } }));
          break;
        }
        case 'ready':
          sentOverlays.current.clear();
          loadedOverlays.current.clear();
          setGeneration((g) => g + 1);
          break;
        case 'longPress':
          props.onLongPress?.(p);
          break;
        case 'markerTap':
          props.onMarkerPress?.(p.id);
          break;
        case 'markerDragStart':
          props.onMarkerDragStart?.(p.id);
          break;
        case 'markerMoved':
          props.onMarkerMoved?.(p.id, { lat: p.lat, lng: p.lng });
          break;
        case 'memberTap':
          props.onMemberPress?.(p.id);
          break;
        case 'viewChanged':
          props.onViewChanged?.(p);
          break;
        case 'bearingChanged':
          props.onBearingChanged?.(p.bearing);
          break;
        case 'headingUpChanged':
          props.onHeadingUpChanged?.(p.on);
          break;
        case 'drawChanged':
          props.onDrawChanged?.(p.points);
          break;
        case 'followChanged':
          props.onFollowChanged?.(p.follow);
          break;
        case 'overlayLoaded':
          loadedOverlays.current.add(p.id);
          if (pendingFocus.current === p.id) {
            pendingFocus.current = null;
            send({ type: 'fitOverlay', payload: { id: p.id } });
            props.onFocusHandled?.();
          }
          break;
        case 'overlayError':
          if (pendingFocus.current === p.id) {
            pendingFocus.current = null;
            props.onFocusHandled?.();
          }
          props.onOverlayError?.(p.id, p.message);
          break;
        case 'log':
          if (__DEV__) console.log(`[map ${p.level}]`, p.message);
          break;
      }
    },
    [props, send]
  );

  return <MapFrame ref={frameRef} onMessage={onMessage} />;
}

/** Territory label on the map: number, plus a capture in progress. */
function sectorTitle(m: TacMarker): string {
  const cap = m.cap ? ` · захват ${m.cap.n}/3` : '';
  return `${m.label ?? ''}${cap}`;
}

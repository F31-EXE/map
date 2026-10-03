import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { formatClock } from '../lib/geo';
import { isAdminKind, isOrder, MARKER_KINDS } from '../lib/markerKinds';
import { ROLES, type RoleId } from '../lib/roles';
import type { LatLng, Member, OverlayMeta, SelfPosition, TacMarker } from '../lib/types';
import { loadOverlayPayload } from '../services/overlays';
import { MapFrame, type MapFrameHandle } from './MapFrame';

export type BaseLayerId = 'yandex-sat' | 'yandex-hybrid' | 'yandex-map' | 'esri-sat' | 'osm' | 'topo';

export const BASE_LAYERS: {
  id: BaseLayerId;
  title: string;
  provider: string;
  icon: 'satellite-variant' | 'layers-outline' | 'map-outline' | 'earth' | 'terrain' | 'map-legend';
}[] = [
  { id: 'yandex-sat', title: 'Спутник', provider: 'Яндекс', icon: 'satellite-variant' },
  { id: 'yandex-hybrid', title: 'Гибрид', provider: 'Яндекс', icon: 'layers-outline' },
  { id: 'yandex-map', title: 'Схема', provider: 'Яндекс', icon: 'map-outline' },
  { id: 'esri-sat', title: 'Спутник', provider: 'Esri', icon: 'earth' },
  { id: 'topo', title: 'Топо', provider: 'OpenTopoMap', icon: 'terrain' },
  { id: 'osm', title: 'Схема', provider: 'OpenStreetMap', icon: 'map-legend' },
];

/** Positions older than this are drawn faded. */
export const STALE_MS = 2 * 60_000;

export type TacticalMapHandle = {
  centerOnSelf: () => void;
  fitOverlay: (id: string) => void;
  setView: (p: LatLng, zoom?: number) => void;
  fitPoints: (points: LatLng[]) => void;
};

type Props = {
  ref?: Ref<TacticalMapHandle>;
  baseLayer: BaseLayerId;
  self: SelfPosition | null;
  /** Own role and color for the self marker. */
  selfRole?: RoleId;
  selfColor?: string;
  follow: boolean;
  /** Coordinate grid overlay. */
  grid?: boolean;
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
  onMemberPress?: (id: string) => void;
  onViewChanged?: (p: LatLng & { zoom: number }) => void;
  onFollowChanged?: (follow: boolean) => void;
  onOverlayError?: (id: string, message: string) => void;
  /** Game analysis overlay: tracks as [lat, lng] segments, heat as [lat, lng] samples. */
  analysis?: {
    tracks: { color: string; segments: [number, number][][] }[];
    heat: [number, number][];
    showTracks: boolean;
    showHeat: boolean;
  } | null;
  /** Pixels at the bottom covered by native panels (scale bar goes above). */
  bottomInset?: number;
  /** Pixels at the top covered by native panels (grid labels go below). */
  topInset?: number;
  /** Arrow drawing mode: taps add points (reported via onDrawChanged). */
  drawing?: { color: string; points: LatLng[] } | null;
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

  useImperativeHandle(
    props.ref,
    () => ({
      centerOnSelf: () => send({ type: 'centerOnSelf' }),
      fitOverlay: (id) => send({ type: 'fitOverlay', payload: { id } }),
      setView: (p, zoom) => send({ type: 'setView', payload: { ...p, zoom } }),
      fitPoints: (points) => send({ type: 'fitPoints', payload: points }),
    }),
    [send]
  );

  // Re-evaluate member staleness even when nothing else changes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const ready = generation > 0;

  useEffect(() => {
    if (ready) send({ type: 'setBaseLayer', payload: { id: props.baseLayer } });
  }, [ready, generation, props.baseLayer, send]);

  useEffect(() => {
    if (!ready) return;
    const { self, selfRole, selfColor } = props;
    send({
      type: 'setSelf',
      payload: self && { ...self, rolePath: selfRole ? ROLES[selfRole].path : null, color: selfColor ?? null },
    });
  }, [ready, generation, props.self, props.selfRole, props.selfColor, send]);

  useEffect(() => {
    if (ready) send({ type: 'setGrid', payload: { on: Boolean(props.grid) } });
  }, [ready, generation, props.grid, send]);

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
        callsign: m.callsign,
        color: m.color ?? props.teamColor,
        rolePath: ROLES[m.role].path,
        roleTitle: ROLES[m.role].title,
        commander: m.leader ?? (m.canCommand || m.id === props.ownerId),
        heading: m.heading,
        status: m.status,
        stale: !m.updatedAt || now - m.updatedAt > STALE_MS,
      }));
    send({ type: 'setMembers', payload: list });
  }, [ready, generation, props.members, props.selfId, props.teamColor, props.ownerId, now, send]);

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
        order: isOrder(m.kind),
        admin: isAdminKind(m.kind),
        personal: Boolean(m.personal),
        time: formatClock(m.createdAt),
      };
    });
    send({ type: 'setMarkers', payload: list });
  }, [ready, generation, props.markers, send]);

  const analysis = props.analysis;
  useEffect(() => {
    if (ready) send({ type: 'setAnalysis', payload: analysis ?? null });
  }, [ready, generation, analysis, send]);

  const { bottomInset, topInset } = props;
  useEffect(() => {
    if (ready && bottomInset != null) send({ type: 'setInsets', payload: { bottom: bottomInset, top: topInset ?? 0 } });
  }, [ready, generation, bottomInset, topInset, send]);

  const drawing = props.drawing;
  useEffect(() => {
    if (!ready) return;
    send({ type: 'setDraw', payload: drawing ? { on: true, color: drawing.color, points: drawing.points } : null });
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
        case 'memberTap':
          props.onMemberPress?.(p.id);
          break;
        case 'viewChanged':
          props.onViewChanged?.(p);
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

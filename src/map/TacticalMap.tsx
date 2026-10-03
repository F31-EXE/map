import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { MARKER_KINDS } from '../lib/markerKinds';
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
};

type Props = {
  ref?: Ref<TacticalMapHandle>;
  baseLayer: BaseLayerId;
  self: SelfPosition | null;
  follow: boolean;
  members: Member[];
  /** Own uid — excluded from the members layer (drawn as `self`). */
  selfId: string | null;
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
    if (ready) send({ type: 'setSelf', payload: props.self });
  }, [ready, generation, props.self, send]);

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
        color: m.color,
        heading: m.heading,
        stale: !m.updatedAt || now - m.updatedAt > STALE_MS,
      }));
    send({ type: 'setMembers', payload: list });
  }, [ready, generation, props.members, props.selfId, now, send]);

  useEffect(() => {
    if (!ready) return;
    const list = props.markers.map((m) => {
      const k = MARKER_KINDS[m.kind] ?? MARKER_KINDS.note;
      return { id: m.id, lat: m.lat, lng: m.lng, label: m.label, path: k.path, color: k.color };
    });
    send({ type: 'setMarkers', payload: list });
  }, [ready, generation, props.markers, send]);

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

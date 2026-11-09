import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Platform } from 'react-native';

import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { LatLng, OverlayFormat, OverlayMeta } from '../lib/types';
import type { Bounds } from '../lib/tiles';
import * as offline from '../services/offlineMaps';
import * as svc from '../services/overlays';
import * as shared from '../services/sharedMaps';

import { useSession } from './session';

type Overlays = {
  overlays: OverlayMeta[];
  importOverlay: () => Promise<OverlayMeta | null>;
  /** Downloads a map by URL (calendar polygon); replaces an earlier copy with the same name. */
  importOverlayFromUrl: (url: string, name: string, format: OverlayFormat) => Promise<OverlayMeta>;
  removeOverlay: (id: string) => Promise<void>;
  setVisible: (id: string, visible: boolean) => Promise<void>;
  /** Set by the maps screen; the map screen fits to it once and clears it. */
  focusRequest: string | null;
  requestFocus: (id: string | null) => void;
  /** A point to center the map on (calendar polygon without a map file); consumed like focusRequest. */
  viewRequest: (LatLng & { zoom: number }) | null;
  requestView: (v: (LatLng & { zoom: number }) | null) => void;

  /** Base-layer areas saved for use without internet. */
  areas: offline.OfflineArea[];
  /** Download in progress, if any. */
  download: { areaId: string; done: number; total: number; part: number; parts: number } | null;
  downloadArea: (layer: string, name: string, b: Bounds, minZoom: number, maxZoom: number) => Promise<void>;
  cancelDownload: () => void;
  removeArea: (id: string) => Promise<void>;

  /** Maps shared with the squad; new ones are downloaded and added automatically. */
  sharedMaps: shared.SharedMap[];
  /** Sends an imported map to everyone in the squad. */
  shareOverlay: (id: string) => Promise<void>;
  /** Takes a squad map away from everyone (author or a superior). */
  unshareMap: (m: shared.SharedMap) => Promise<void>;
  /** Downloads a squad map again (after it was removed on this phone). */
  fetchShared: (m: shared.SharedMap) => Promise<void>;
};

const Ctx = createContext<Overlays | null>(null);

export function useOverlays(): Overlays {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOverlays must be used inside <OverlaysProvider>');
  return v;
}

export function OverlaysProvider({ children }: { children: ReactNode }) {
  const [overlays, setOverlays] = useState<OverlayMeta[]>([]);
  const [focusRequest, requestFocus] = useState<string | null>(null);
  const [viewRequest, requestView] = useState<(LatLng & { zoom: number }) | null>(null);
  const [areas, setAreas] = useState<offline.OfflineArea[]>([]);
  const [download, setDownload] = useState<{ areaId: string; done: number; total: number; part: number; parts: number } | null>(
    null
  );
  const stopRef = useRef(false);
  const areasRef = useRef(areas);
  areasRef.current = areas;

  useEffect(() => {
    svc.listOverlays().then(setOverlays);
    offline.listAreas().then(setAreas);
    loadJson<string[]>(KEYS.sharedMapsDismissed, []).then(setDismissed);
  }, []);

  // Squad maps: listen, and bring new ones onto this phone.
  const { teamId, uid, callsign } = useSession();
  const [sharedMaps, setSharedMaps] = useState<shared.SharedMap[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    setSharedMaps([]);
    if (!teamId || !uid) return;
    return shared.subscribeSharedMaps(teamId, setSharedMaps, () => {});
  }, [teamId, uid]);
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const fetching = useRef(new Set<string>());

  const commitAreas = useCallback(async (next: offline.OfflineArea[]) => {
    setAreas(next);
    await offline.saveAreas(next);
  }, []);

  const downloadArea = useCallback(
    async (layer: string, name: string, b: Bounds, minZoom: number, maxZoom: number) => {
      if (download) throw new Error('Уже идёт скачивание');
      const plan = offline.planDownload(layer, b, minZoom, maxZoom);
      if (!plan.fits || !plan.parts.length) throw new Error('Район слишком большой для этого телефона. Приблизьте карту.');
      stopRef.current = false;
      const n = plan.parts.length;
      try {
        // Big regions go part by part; each part is its own area, usable as soon as
        // it's down even if a later one is cut short.
        for (let i = 0; i < n && !stopRef.current; i++) {
          const area = offline.newArea(layer, n > 1 ? `${name} · ${i + 1}/${n}` : name, plan.parts[i], minZoom, maxZoom);
          await commitAreas([...areasRef.current, area]);
          setDownload({ areaId: area.id, done: 0, total: 0, part: i + 1, parts: n });
          try {
            const result = await offline.downloadArea(
              area,
              (done, total) => setDownload({ areaId: area.id, done, total, part: i + 1, parts: n }),
              () => stopRef.current
            );
            await commitAreas(areasRef.current.map((a) => (a.id === area.id ? result : a)));
          } catch (e) {
            await commitAreas(areasRef.current.filter((a) => a.id !== area.id));
            offline.deleteAreaFiles(area);
            throw e;
          }
        }
      } finally {
        setDownload(null);
      }
    },
    [download, commitAreas]
  );

  const cancelDownload = useCallback(() => {
    stopRef.current = true;
  }, []);

  const removeArea = useCallback(
    async (id: string) => {
      const a = areasRef.current.find((x) => x.id === id);
      if (a) offline.deleteAreaFiles(a);
      await commitAreas(areasRef.current.filter((x) => x.id !== id));
    },
    [commitAreas]
  );

  const commit = useCallback(async (next: OverlayMeta[]) => {
    setOverlays(next);
    await svc.saveOverlays(next);
  }, []);

  const importOverlay = useCallback(async () => {
    const meta = await svc.pickAndImportOverlay();
    if (meta) {
      await commit([...overlays, meta]);
      requestFocus(meta.id);
    }
    return meta;
  }, [overlays, commit]);

  const importOverlayFromUrl = useCallback(
    async (url: string, name: string, format: OverlayFormat) => {
      const meta = await svc.importOverlayFromUrl(url, name, format);
      // The same polygon opened again replaces its old copy instead of piling up.
      const stale = overlays.filter((o) => o.name === meta.name);
      stale.forEach((o) => svc.deleteOverlayFile(o));
      await commit([...overlays.filter((o) => o.name !== meta.name), meta]);
      requestFocus(meta.id);
      return meta;
    },
    [overlays, commit]
  );

  const removeOverlay = useCallback(
    async (id: string) => {
      const meta = overlays.find((o) => o.id === id);
      if (meta) svc.deleteOverlayFile(meta);
      await commit(overlays.filter((o) => o.id !== id));
      // A squad map removed here stays removed here (others keep it).
      if (meta?.sharedId) {
        const next = [...dismissed, meta.sharedId];
        setDismissed(next);
        await saveJson(KEYS.sharedMapsDismissed, next);
      }
    },
    [overlays, commit, dismissed]
  );

  const fetchShared = useCallback(
    async (m: shared.SharedMap) => {
      if (!teamId || fetching.current.has(m.id)) return;
      fetching.current.add(m.id);
      try {
        const bytes = await shared.fetchSharedMap(teamId, m);
        const meta = await svc.saveOverlayBytes(m.name, m.format, bytes, m.id);
        await commit([...overlaysRef.current.filter((o) => o.sharedId !== m.id), meta]);
        if (dismissed.includes(m.id)) {
          const next = dismissed.filter((x) => x !== m.id);
          setDismissed(next);
          await saveJson(KEYS.sharedMapsDismissed, next);
        }
      } finally {
        fetching.current.delete(m.id);
      }
    },
    [teamId, commit, dismissed]
  );

  useEffect(() => {
    // The web version keeps no files.
    if (Platform.OS === 'web') return;
    for (const m of sharedMaps) {
      if (dismissed.includes(m.id) || overlaysRef.current.some((o) => o.sharedId === m.id)) continue;
      fetchShared(m).catch(() => {});
    }
  }, [sharedMaps, dismissed, fetchShared]);

  const shareOverlay = useCallback(
    async (id: string) => {
      const meta = overlays.find((o) => o.id === id);
      if (!meta) throw new Error('Карта не найдена');
      if (!teamId || !uid) throw new Error('Сначала вступите в отряд');
      const bytes = await svc.readOverlayBytes(meta);
      const sharedId = await shared.shareMap(teamId, { uid, callsign: callsign || 'Боец' }, meta, bytes);
      await commit(overlaysRef.current.map((o) => (o.id === id ? { ...o, sharedId } : o)));
    },
    [overlays, teamId, uid, callsign, commit]
  );

  const unshareMap = useCallback(
    async (m: shared.SharedMap) => {
      if (!teamId) return;
      await shared.unshareMap(teamId, m);
    },
    [teamId]
  );

  const setVisible = useCallback(
    async (id: string, visible: boolean) => {
      await commit(overlays.map((o) => (o.id === id ? { ...o, visible } : o)));
    },
    [overlays, commit]
  );

  const value = useMemo(
    () => ({
      overlays,
      importOverlay,
      importOverlayFromUrl,
      removeOverlay,
      setVisible,
      focusRequest,
      requestFocus,
      viewRequest,
      requestView,
      areas,
      download,
      downloadArea,
      cancelDownload,
      removeArea,
      sharedMaps,
      shareOverlay,
      unshareMap,
      fetchShared,
    }),
    [overlays, importOverlay, importOverlayFromUrl, removeOverlay, setVisible, focusRequest, viewRequest, areas, download, downloadArea, cancelDownload, removeArea, sharedMaps, shareOverlay, unshareMap, fetchShared]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

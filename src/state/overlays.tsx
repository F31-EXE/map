import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { LatLng, OverlayFormat, OverlayMeta } from '../lib/types';
import type { Bounds } from '../lib/tiles';
import * as offline from '../services/offlineMaps';
import * as svc from '../services/overlays';

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
  }, []);

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
    },
    [overlays, commit]
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
    }),
    [overlays, importOverlay, importOverlayFromUrl, removeOverlay, setVisible, focusRequest, viewRequest, areas, download, downloadArea, cancelDownload, removeArea]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { KEYS, loadJson, saveJson } from '../lib/storage';
import {
  DIRECT_DOWNLOAD,
  fetchIndex,
  importRegionFile,
  openRegionDownload,
  hasRegionFile,
  RegionDownload,
  REGIONS_SUPPORTED,
  removeRegion,
  type Progress,
  type RegionInfo,
} from '../services/vectorRegions';

export type LocalRegion = Omit<RegionInfo, 'url'>;
export type DownloadState = Progress & { paused: boolean };

type RegionsState = {
  supported: boolean;
  /** Regions on the server (null until loaded). */
  index: RegionInfo[] | null;
  indexError: string | null;
  refreshIndex: () => Promise<void>;
  /** Regions downloaded on this phone. */
  local: LocalRegion[];
  downloads: Record<string, DownloadState>;
  download: (r: RegionInfo) => void;
  /** Browser: downloads come as files; this adds one (from a click). */
  directDownload: boolean;
  addFile: (r: RegionInfo) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  /** Asks the map screen to switch to the «Схема офлайн» layer (changes each request). */
  showRequest: number;
  showOnMap: () => void;
};

const Ctx = createContext<RegionsState | null>(null);

export function useRegions(): RegionsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRegions must be used inside <RegionsProvider>');
  return v;
}

export function RegionsProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<RegionInfo[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalRegion[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const tasks = useRef(new Map<string, RegionDownload>());
  const [showRequest, setShowRequest] = useState(0);

  useEffect(() => {
    if (!REGIONS_SUPPORTED) return;
    // Keep only regions whose file is still there.
    loadJson<LocalRegion[]>(KEYS.vectorRegions, []).then((list) => setLocal(list.filter((r) => hasRegionFile(r.id))));
  }, []);

  const saveLocal = useCallback((update: (cur: LocalRegion[]) => LocalRegion[]) => {
    setLocal((cur) => {
      const next = update(cur);
      saveJson(KEYS.vectorRegions, next).catch(() => {});
      return next;
    });
  }, []);

  const refreshIndex = useCallback(async () => {
    setIndexError(null);
    try {
      setIndex(await fetchIndex());
    } catch (e) {
      setIndexError((e as Error).message || 'Нет связи');
    }
  }, []);

  const setProgress = useCallback((id: string, p: Partial<DownloadState> | null) => {
    setDownloads(({ [id]: cur, ...rest }) => {
      if (p == null) return rest;
      const base: DownloadState = cur ?? { received: 0, total: 0, paused: false };
      return { ...rest, [id]: { ...base, ...p } };
    });
  }, []);

  const run = useCallback(
    async (id: string, go: () => Promise<boolean>) => {
      const t = tasks.current.get(id);
      if (!t) return;
      try {
        const done = await go();
        if (!done) return; // paused or cancelled
        tasks.current.delete(id);
        setProgress(id, null);
        const { url: _url, ...info } = t.region;
        saveLocal((cur) => [...cur.filter((r) => r.id !== id), info]);
      } catch (e) {
        if (tasks.current.get(id) !== t) return; // cancelled
        tasks.current.delete(id);
        setProgress(id, null);
        Alert.alert('Регион не скачался', `${t.region.name}: ${(e as Error).message || 'нет связи'}. Попробуйте ещё раз.`);
      }
    },
    [saveLocal, setProgress]
  );

  const value = useMemo<RegionsState>(
    () => ({
      supported: REGIONS_SUPPORTED,
      index,
      indexError,
      refreshIndex,
      local,
      downloads,
      directDownload: DIRECT_DOWNLOAD,
      addFile: (r) => {
        setProgress(r.id, { received: 0, total: r.bytes, paused: false });
        importRegionFile(r.id, (p) => setProgress(r.id, p))
          .then((ok) => {
            if (!ok) return;
            const { url: _url, ...info } = r;
            saveLocal((cur) => [...cur.filter((x) => x.id !== r.id), info]);
          })
          .catch((e: Error) => Alert.alert('Файл не добавился', e.message))
          .finally(() => setProgress(r.id, null));
      },
      download: (r) => {
        if (!DIRECT_DOWNLOAD) {
          openRegionDownload(r);
          return;
        }
        if (tasks.current.has(r.id)) return;
        const t = new RegionDownload(r, (p) => setProgress(r.id, p));
        tasks.current.set(r.id, t);
        setProgress(r.id, { received: 0, total: r.bytes, paused: false });
        run(r.id, () => t.start());
      },
      pause: (id) => {
        const t = tasks.current.get(id);
        if (!t) return;
        setProgress(id, { paused: true });
        t.pause().catch(() => {});
      },
      resume: (id) => {
        const t = tasks.current.get(id);
        if (!t) return;
        setProgress(id, { paused: false });
        run(id, () => t.resume());
      },
      cancel: (id) => {
        const t = tasks.current.get(id);
        tasks.current.delete(id);
        setProgress(id, null);
        t?.cancel();
      },
      remove: (id) => {
        removeRegion(id);
        saveLocal((cur) => cur.filter((r) => r.id !== id));
      },
      showRequest,
      showOnMap: () => setShowRequest((n) => n + 1),
    }),
    [index, indexError, refreshIndex, local, downloads, run, saveLocal, setProgress, showRequest]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

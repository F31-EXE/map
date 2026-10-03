import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { OverlayMeta } from '../lib/types';
import * as svc from '../services/overlays';

type Overlays = {
  overlays: OverlayMeta[];
  importOverlay: () => Promise<OverlayMeta | null>;
  removeOverlay: (id: string) => Promise<void>;
  setVisible: (id: string, visible: boolean) => Promise<void>;
  /** Set by the maps screen; the map screen fits to it once and clears it. */
  focusRequest: string | null;
  requestFocus: (id: string | null) => void;
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

  useEffect(() => {
    svc.listOverlays().then(setOverlays);
  }, []);

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
    () => ({ overlays, importOverlay, removeOverlay, setVisible, focusRequest, requestFocus }),
    [overlays, importOverlay, removeOverlay, setVisible, focusRequest]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { useEffect, useMemo, useRef, useState } from 'react';

import { canSeeTracker, shouldRelay, trackerFix, trackerId, type HeardFix, type Tracker } from '../lib/trackers';
import type { Member } from '../lib/types';
import { relayTracker, subscribeTrackers } from '../services/trackers';

import { useSession } from './session';

export type TrackerView = Tracker & { fix: HeardFix | null; heardHere: boolean };

/**
 * The squad's trackers with their freshest position (server or my radio). With
 * `relay`, positions my radio heard go to the server (the map screen does this, once).
 */
export function useTrackers(relay = false): { trackers: TrackerView[]; visible: TrackerView[]; members: Member[] } {
  const session = useSession();
  const { teamId, uid, canCommand, firebaseEnabled } = session;
  const nodes = session.mesh.radio.nodes;
  const [list, setList] = useState<Tracker[]>([]);

  useEffect(() => {
    if (!teamId || !firebaseEnabled) {
      setList([]);
      return;
    }
    return subscribeTrackers(teamId, setList, () => {});
  }, [teamId, firebaseEnabled]);

  const trackers = useMemo<TrackerView[]>(() => {
    const heard = new Map(nodes.filter((n) => n.lat != null && n.lng != null && n.posAt).map((n) => [n.num, n]));
    return list.map((t) => {
      const n = heard.get(t.num);
      const h = n ? { lat: n.lat!, lng: n.lng!, at: n.posAt! } : null;
      const fix = trackerFix(t, h);
      return { ...t, fix, heardHere: Boolean(h && fix === h) };
    });
  }, [list, nodes]);

  // Relay what my radio heard: newer than the server's by a minute, once a minute per tracker.
  const lastRelay = useRef(new Map<number, number>());
  useEffect(() => {
    if (!relay || !teamId || !uid) return;
    const now = Date.now();
    for (const t of trackers) {
      if (!t.heardHere || !t.fix) continue;
      if (!shouldRelay(t, t.fix, lastRelay.current.get(t.num) ?? null, now)) continue;
      lastRelay.current.set(t.num, now);
      relayTracker(teamId, uid, t.num, t.fix).catch(() => {});
    }
  }, [relay, trackers, teamId, uid]);

  const visible = useMemo(() => trackers.filter((t) => canSeeTracker(t, uid, canCommand)), [trackers, uid, canCommand]);

  const members = useMemo<Member[]>(
    () =>
      visible
        .filter((t) => t.fix)
        .map((t) => ({
          id: `trk/${trackerId(t.num)}`,
          callsign: t.name,
          role: t.role,
          canCommand: false,
          status: 'alive',
          lat: t.fix!.lat,
          lng: t.fix!.lng,
          heading: null,
          updatedAt: t.fix!.at,
          color: t.color,
          tracker: t.num,
        })),
    [visible]
  );

  return { trackers, visible, members };
}

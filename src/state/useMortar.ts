import { useCallback, useEffect, useState } from 'react';

import { DEFAULT_MORTAR, validConfig, type MortarConfig } from '../lib/mortar';
import { KEYS, loadJson, saveJson } from '../lib/storage';
import type { LatLng } from '../lib/types';
import * as teams from '../services/teams';

import { useSession } from './session';

/**
 * This phone's mortar: range and test shots, plus an optional fixed firing position
 * (otherwise the crew fires from where the phone is). Mortar crews publish their range
 * on the member doc so everyone draws the right circle around them.
 */
export function useMortar() {
  const { role, teamId, uid, members } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [config, setConfigState] = useState<MortarConfig>(DEFAULT_MORTAR);
  const [fixed, setFixedState] = useState<LatLng | null>(null);

  useEffect(() => {
    Promise.all([loadJson<unknown>(KEYS.mortar, null), loadJson<LatLng | null>(KEYS.mortarPos, null)]).then(
      ([c, p]) => {
        setConfigState(validConfig(c));
        setFixedState(p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null);
        setLoaded(true);
      }
    );
  }, []);

  const setConfig = useCallback((c: MortarConfig) => {
    setConfigState(c);
    saveJson(KEYS.mortar, c).catch(() => {});
  }, []);

  const setFixed = useCallback((p: LatLng | null) => {
    setFixedState(p);
    saveJson(KEYS.mortarPos, p).catch(() => {});
  }, []);

  const myRange = members.find((m) => m.id === uid)?.range;
  const isMortar = role === 'mortar';
  useEffect(() => {
    if (!loaded || !isMortar || !teamId || !uid || myRange === undefined || myRange === config.range) return;
    teams.updateProfile(teamId, uid, { range: config.range }).catch(() => {});
  }, [loaded, isMortar, teamId, uid, myRange, config.range]);

  return { isMortar, config, setConfig, fixed, setFixed };
}

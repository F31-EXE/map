import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TacMarker } from '../lib/types';
import { loadPhoto } from '../services/teams';

import { Icon, Sheet } from './components';
import { C, F, R } from './theme';

// Pictures don't change: keep them for the session instead of re-reading Firestore.
const cache = new Map<string, string>();

/** The picture of a photo marker; tap for full size. */
export function PhotoView({ marker, teamId }: { marker: TacMarker; teamId: string | null }) {
  const key = marker.photoId ? `${teamId}/${marker.photoId}` : null;
  const [data, setData] = useState<string | null>(marker.photoData ?? (key ? (cache.get(key) ?? null) : null));
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (data || !key || !teamId || !marker.photoId) return;
    let alive = true;
    loadPhoto(teamId, marker.photoId)
      .then((d) => {
        if (!alive) return;
        if (d) {
          cache.set(key, d);
          setData(d);
        } else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [data, key, teamId, marker.photoId]);

  if (!data) {
    return (
      <View style={[styles.box, styles.empty]}>
        {failed ? (
          <>
            <Icon name="image-off-outline" size={26} color={C.dim} />
            <Text style={styles.sub}>Фото загрузится, когда будет интернет</Text>
          </>
        ) : (
          <ActivityIndicator color={C.accent} />
        )}
      </View>
    );
  }
  return (
    <>
      <Pressable onPress={() => setFull(true)} accessibilityLabel="Открыть фото">
        <Image source={{ uri: data }} style={styles.box} resizeMode="cover" />
      </Pressable>
      <Sheet visible={full} onClose={() => setFull(false)}>
        <Image source={{ uri: data }} style={styles.full} resizeMode="contain" />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', height: 220, borderRadius: R.md, backgroundColor: C.elevated },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  sub: { color: C.dim, fontSize: 13, fontFamily: F.regular },
  full: { width: '100%', aspectRatio: 3 / 4, borderRadius: R.md },
});

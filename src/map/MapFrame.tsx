import { File, Paths } from 'expo-file-system';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { MAP_HTML } from './mapHtml.generated';

/**
 * The page is written to the documents folder and loaded from there, so it may read
 * downloaded tiles (offline/…) next to it as files. Falls back to inline HTML.
 */
function pageSource(): { uri: string } | { html: string } {
  try {
    const file = new File(Paths.document, 'map.html');
    if (!file.exists || file.textSync() !== MAP_HTML) {
      if (!file.exists) file.create({ intermediates: true, overwrite: true });
      file.write(MAP_HTML);
    }
    return { uri: file.uri };
  } catch {
    return { html: MAP_HTML };
  }
}

export type MapFrameHandle = { post: (msg: { type: string; payload?: unknown }) => void };

/** Hosts the Leaflet page. Native: WebView; web: see MapFrame.web.tsx. */
export function MapFrame({ ref, onMessage }: { ref?: Ref<MapFrameHandle>; onMessage: (data: string) => void }) {
  const webRef = useRef<WebView>(null);
  const [source] = useState(pageSource);

  useImperativeHandle(
    ref,
    () => ({
      post: (msg) =>
        webRef.current?.injectJavaScript(`window.__tacmap && window.__tacmap(${JSON.stringify(msg)}); true;`),
    }),
    []
  );

  // If the OS kills the WebView renderer, reload it; 'ready' then resends everything.
  const reload = useCallback(() => webRef.current?.reload(), []);

  return (
    <WebView
      ref={webRef}
      style={styles.web}
      originWhitelist={['*']}
      source={source}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowingReadAccessToURL={Paths.document.uri}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      bounces={false}
      overScrollMode="never"
      scrollEnabled={false}
      textInteractionEnabled={false}
      onContentProcessDidTerminate={reload}
      onRenderProcessGone={reload}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#090C0B' },
});

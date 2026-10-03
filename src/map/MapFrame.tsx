import { useCallback, useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { MAP_HTML } from './mapHtml.generated';

export type MapFrameHandle = { post: (msg: { type: string; payload?: unknown }) => void };

/** Hosts the Leaflet page. Native: WebView; web: see MapFrame.web.tsx. */
export function MapFrame({ ref, onMessage }: { ref?: Ref<MapFrameHandle>; onMessage: (data: string) => void }) {
  const webRef = useRef<WebView>(null);

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
      source={{ html: MAP_HTML }}
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

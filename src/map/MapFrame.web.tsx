import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

import type { MapFrameHandle } from './MapFrame';
import { MAP_HTML } from './mapHtml.generated';

// The map page talks to `window.ReactNativeWebView`; in a browser we provide one
// that forwards to the parent window.
const SHIM =
  '<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage({__tacmap:m},"*")}};</script>';
const HTML = MAP_HTML.replace('<head>', '<head>' + SHIM);

export function MapFrame({ ref, onMessage }: { ref?: Ref<MapFrameHandle>; onMessage: (data: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useImperativeHandle(
    ref,
    () => ({
      post: (msg) => {
        const w = frame.current?.contentWindow as (Window & { __tacmap?: (m: unknown) => void }) | null;
        w?.__tacmap?.(msg);
      },
    }),
    []
  );

  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && typeof e.data?.__tacmap === 'string') {
        handler.current(e.data.__tacmap);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  return (
    <iframe
      ref={frame}
      srcDoc={HTML}
      title="map"
      style={{ border: 0, width: '100%', height: '100%', flex: 1, background: '#090C0B' }}
    />
  );
}

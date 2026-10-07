import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { SurfaceProps } from './MapSurface';

/** The web preview uses the same Leaflet document and message contract as mobile. */
export function MapSurface({ ref, html, baseUrl, onMessage }: SurfaceProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onMessage);
  useEffect(() => { callback.current = onMessage; }, [onMessage]);
  useImperativeHandle(ref, () => ({
    send: (data: string) => frame.current?.contentWindow?.postMessage({ channel: 'magaalo-to-map', data }, window.location.origin),
  }));
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.origin === window.location.origin && event.data?.channel === 'magaalo-from-map' && typeof event.data.data === 'string') {
        callback.current(event.data.data);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const source = useMemo(() => {
    const base = baseUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const origin = JSON.stringify(window.location.origin);
    const bridge = `<base href="${base}"><script>
      window.ReactNativeWebView={postMessage:function(data){parent.postMessage({channel:'magaalo-from-map',data:data},${origin})}};
      window.addEventListener('message',function(e){if(e.source===parent&&e.origin===${origin}&&e.data&&e.data.channel==='magaalo-to-map'&&window.magaaloReceive){window.magaaloReceive(e.data.data)}});
    </script>`;
    return html.replace('<head>', '<head>' + bridge);
  }, [html, baseUrl]);
  return <iframe ref={frame} title="Magaalo map" srcDoc={source} style={{ width: '100%', height: '100%', border: 0, background: '#F0F1EB' }} />;
}

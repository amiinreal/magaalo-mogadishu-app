import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { WebView } from 'react-native-webview';

export type SurfaceHandle = { send: (data: string) => void };
export type SurfaceProps = { ref?: Ref<SurfaceHandle>; html: string; baseUrl: string; onMessage: (data: string) => void; onReload: () => void };

export function MapSurface({ ref, html, baseUrl, onMessage, onReload }: SurfaceProps) {
  const handlers = useRef({ onMessage, onReload });
  useEffect(() => { handlers.current = { onMessage, onReload }; }, [onMessage, onReload]);
  const message = useCallback((data: string) => handlers.current.onMessage(data), []);
  const reload = useCallback(() => handlers.current.onReload(), []);
  return <NativeMapDocument ref={ref} html={html} baseUrl={baseUrl} onMessage={message} onReload={reload} />;
}

// Center/GPS updates must not send the HTML source to Android's WebView again.
const NativeMapDocument = memo(function NativeMapDocument({ ref, html, baseUrl, onMessage, onReload }: SurfaceProps) {
  const web = useRef<WebView>(null);
  const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
  useImperativeHandle(ref, () => ({
    send: data => web.current?.injectJavaScript(`window.magaaloReceive(${JSON.stringify(data)});true;`),
  }));
  return <WebView ref={web} originWhitelist={['*']} source={source}
    onMessage={e => onMessage(e.nativeEvent.data)} javaScriptEnabled domStorageEnabled cacheEnabled
    setSupportMultipleWindows={false} bounces={false} overScrollMode="never"
    style={{ flex: 1, backgroundColor: '#F0F1EB' }}
    onContentProcessDidTerminate={() => { onReload(); web.current?.reload(); }} />;
});

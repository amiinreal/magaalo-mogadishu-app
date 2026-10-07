import { useImperativeHandle, useRef, type Ref } from 'react';
import { WebView } from 'react-native-webview';

export type SurfaceHandle = { send: (data: string) => void };
export type SurfaceProps = { ref?: Ref<SurfaceHandle>; html: string; baseUrl: string; onMessage: (data: string) => void; onReload: () => void };

export function MapSurface({ ref, html, baseUrl, onMessage, onReload }: SurfaceProps) {
  const web = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({
    send: data => web.current?.injectJavaScript(`window.magaaloReceive(${JSON.stringify(data)});true;`),
  }));
  return <WebView ref={web} originWhitelist={['*']} source={{ html, baseUrl }}
    onMessage={e => onMessage(e.nativeEvent.data)} javaScriptEnabled domStorageEnabled cacheEnabled
    setSupportMultipleWindows={false} bounces={false} overScrollMode="never"
    style={{ flex: 1, backgroundColor: '#F0F1EB' }}
    onContentProcessDidTerminate={() => { onReload(); web.current?.reload(); }} />;
}

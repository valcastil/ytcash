import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { buildMapHtml, type MapMessage, type MapUser } from '@/constants/map-html';
import { BitcoinColors } from '@/constants/theme';

export interface UsersMapHandle {
  /** Re-frame the map around everyone currently shown. */
  fit: () => void;
}

interface UsersMapProps {
  users: MapUser[];
  meId: string | null;
  onError?: () => void;
}

/** Native map: a Leaflet page in a WebView. See users-map.web.tsx for the web version. */
export const UsersMap = forwardRef<UsersMapHandle, UsersMapProps>(function UsersMap(
  { users, meId, onError },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildMapHtml(), []);

  const post = useCallback((message: MapMessage) => {
    // JSON is a safe JS literal here; the page only ever treats names as text.
    webRef.current?.injectJavaScript(
      `window.YTMap && window.YTMap.handle(${JSON.stringify(message)}); true;`,
    );
  }, []);

  useEffect(() => {
    if (ready) post({ type: 'users', users, meId });
  }, [ready, users, meId, post]);

  useImperativeHandle(ref, () => ({ fit: () => post({ type: 'fit' }) }), [post]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message?.type === 'ready') setReady(true);
        else if (message?.type === 'error') onError?.();
      } catch {
        // Ignore anything that is not one of our own messages.
      }
    },
    [onError],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://ytcash.local/' }}
        onMessage={onMessage}
        onError={onError}
        javaScriptEnabled
        domStorageEnabled={false}
        // The page only needs Leaflet + map tiles; keep it from navigating anywhere else.
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith('https://ytcash.local/') || request.url === 'about:blank'
        }
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  web: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
});

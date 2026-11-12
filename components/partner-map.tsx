import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { buildPartnerMapHtml, type MapPartner, type MapPoint, type PartnerMapMessage } from '@/constants/partner-map-html';
import { BitcoinColors } from '@/constants/theme';

export interface PartnerMapProps {
  receiver: (MapPoint & { label: string }) | null;
  partners: MapPartner[];
  selectedId: string | null;
  onSelect?: (partnerId: string) => void;
}

/** Native map of the receiver and nearby partners. See partner-map.web.tsx for the web version. */
export function PartnerMap({ receiver, partners, selectedId, onSelect }: PartnerMapProps) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildPartnerMapHtml(), []);

  useEffect(() => {
    if (!ready) return;
    const message: PartnerMapMessage = { type: 'data', receiver, partners, selectedId };
    // JSON is a safe JS literal here; the page only ever sets names as text.
    webRef.current?.injectJavaScript(`window.YTMap && window.YTMap.handle(${JSON.stringify(message)}); true;`);
  }, [ready, receiver, partners, selectedId]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message?.type === 'ready') setReady(true);
        else if (message?.type === 'select' && typeof message.id === 'string') onSelect?.(message.id);
      } catch {
        // Ignore anything that is not one of our own messages.
      }
    },
    [onSelect],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://ytcash.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        // The page only loads map scripts and tiles; keep it from navigating anywhere else.
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith('https://ytcash.local/') || request.url === 'about:blank'
        }
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  web: { flex: 1, backgroundColor: BitcoinColors.darkBg },
});

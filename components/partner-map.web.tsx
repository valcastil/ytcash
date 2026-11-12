import React, { useEffect, useMemo, useRef, useState } from 'react';

import { buildPartnerMapHtml, type MapPartner, type MapPoint, type PartnerMapMessage } from '@/constants/partner-map-html';
import { BitcoinColors } from '@/constants/theme';

export interface PartnerMapProps {
  receiver: (MapPoint & { label: string }) | null;
  partners: MapPartner[];
  selectedId: string | null;
  onSelect?: (partnerId: string) => void;
}

/** Web map: the same page as native, hosted in a sandboxed iframe. */
export function PartnerMap({ receiver, partners, selectedId, onSelect }: PartnerMapProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildPartnerMapHtml(), []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message?.type === 'ready') setReady(true);
        else if (message?.type === 'select' && typeof message.id === 'string') onSelect?.(message.id);
      } catch {
        // Ignore anything that is not one of our own messages.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);

  useEffect(() => {
    if (!ready) return;
    const message: PartnerMapMessage = { type: 'data', receiver, partners, selectedId };
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, [ready, receiver, partners, selectedId]);

  return (
    <iframe
      ref={frameRef}
      title="Map of nearby partners"
      srcDoc={html}
      sandbox="allow-scripts"
      style={{ flex: 1, width: '100%', height: '100%', border: 0, backgroundColor: BitcoinColors.darkBg }}
    />
  );
}

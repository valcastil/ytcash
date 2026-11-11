import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { buildMapHtml, type MapMessage, type MapUser } from '@/constants/map-html';
import { BitcoinColors } from '@/constants/theme';

export interface UsersMapHandle {
  fit: () => void;
}

interface UsersMapProps {
  users: MapUser[];
  meId: string | null;
  onError?: () => void;
}

/** Web map: the same Leaflet page as native, hosted in a sandboxed iframe. */
export const UsersMap = forwardRef<UsersMapHandle, UsersMapProps>(function UsersMap(
  { users, meId, onError },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildMapHtml(), []);

  const post = useCallback((message: MapMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message?.type === 'ready') setReady(true);
        else if (message?.type === 'error') onError?.();
      } catch {
        // Ignore anything that is not one of our own messages.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onError]);

  useEffect(() => {
    if (ready) post({ type: 'users', users, meId });
  }, [ready, users, meId, post]);

  useImperativeHandle(ref, () => ({ fit: () => post({ type: 'fit' }) }), [post]);

  return (
    <iframe
      ref={frameRef}
      title="Map of users online"
      srcDoc={html}
      sandbox="allow-scripts"
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        border: 0,
        backgroundColor: BitcoinColors.darkBg,
      }}
    />
  );
});

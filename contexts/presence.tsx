import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { useAuth } from '@/contexts/auth';
import { readRoundedLocation, requestRoundedLocation } from '@/services/location';
import { supabase } from '@/services/supabase';
import {
  ONLINE_CHANNEL,
  parsePresenceState,
  publicDisplayName,
  type Coords,
  type OnlineUser,
  type PresencePayload,
} from '@/services/presence';

export type PresenceStatus = 'offline' | 'connecting' | 'online' | 'error';
export type ShareResult = 'granted' | 'denied' | 'blocked' | 'unavailable';

interface PresenceState {
  /** Everyone currently signed in with the app open (including you). */
  onlineUsers: OnlineUser[];
  status: PresenceStatus;
  /** Whether this user has chosen to appear on the map. Off until they opt in. */
  shareLocation: boolean;
  /** This device's rounded location, when sharing is on and a fix is available. */
  myLocation: Coords | null;
  enableLocationSharing: () => Promise<ShareResult>;
  disableLocationSharing: () => Promise<void>;
  refreshLocation: () => Promise<void>;
  reconnect: () => void;
}

const PresenceContext = createContext<PresenceState | undefined>(undefined);

const shareKey = (userId: string) => `ytcash.shareLocation.${userId}`;

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const displayName = publicDisplayName(profile?.full_name);

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [status, setStatus] = useState<PresenceStatus>('offline');
  const [shareLocation, setShareLocation] = useState(false);
  const [myLocation, setMyLocation] = useState<Coords | null>(null);
  const [connectAttempt, setConnectAttempt] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const payloadRef = useRef<PresencePayload | null>(null);
  const onlineAtRef = useRef<string>(new Date().toISOString());

  // Load the saved sharing choice for whoever is signed in.
  useEffect(() => {
    let cancelled = false;
    setShareLocation(false);
    setMyLocation(null);
    if (!userId) return;

    (async () => {
      const saved = await AsyncStorage.getItem(shareKey(userId)).catch(() => null);
      if (cancelled || saved !== '1') return;
      setShareLocation(true);
      const coords = await readRoundedLocation();
      if (!cancelled) setMyLocation(coords);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Join the presence channel while signed in; leave on sign-out.
  useEffect(() => {
    if (!userId) {
      setOnlineUsers([]);
      setStatus('offline');
      return;
    }

    onlineAtRef.current = new Date().toISOString();
    setStatus('connecting');

    const channel = supabase.channel(ONLINE_CHANNEL, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineUsers(parsePresenceState(channel.presenceState()));
      })
      .subscribe(async (state, err) => {
        if (state === 'SUBSCRIBED') {
          setStatus('online');
          // Also runs after an automatic reconnect, which re-announces us.
          if (payloadRef.current) await channel.track(payloadRef.current);
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          console.warn('Presence channel notice:', err?.message ?? state);
          setStatus('error');
        } else if (state === 'CLOSED') {
          setStatus('offline');
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId, connectAttempt]);

  // Keep what we announce in sync with name / sharing choice / location.
  useEffect(() => {
    if (!userId) {
      payloadRef.current = null;
      return;
    }

    const visible = shareLocation && myLocation !== null;
    const payload: PresencePayload = {
      user_id: userId,
      name: displayName,
      lat: visible ? myLocation.lat : null,
      lng: visible ? myLocation.lng : null,
      online_at: onlineAtRef.current,
      platform: Platform.OS,
    };
    payloadRef.current = payload;

    if (status === 'online' && channelRef.current) {
      channelRef.current.track(payload).catch((e) => console.warn('Presence track failed:', e));
    }
  }, [userId, displayName, shareLocation, myLocation, status]);

  const refreshLocation = useCallback(async () => {
    if (!shareLocation) return;
    const coords = await readRoundedLocation();
    if (coords) setMyLocation(coords);
  }, [shareLocation]);

  // "Online" means the app is open: drop off when backgrounded, return when reopened.
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;

    const sub = AppState.addEventListener('change', (next) => {
      const channel = channelRef.current;
      if (!channel) return;

      if (next === 'active') {
        if (payloadRef.current) channel.track(payloadRef.current).catch(() => {});
        refreshLocation();
      } else if (next === 'background') {
        channel.untrack().catch(() => {});
      }
    });

    return () => sub.remove();
  }, [userId, refreshLocation]);

  const enableLocationSharing = useCallback(async (): Promise<ShareResult> => {
    if (!userId) return 'unavailable';
    const result = await requestRoundedLocation();
    if (result.status !== 'granted') return result.status;

    setMyLocation(result.coords);
    setShareLocation(true);
    await AsyncStorage.setItem(shareKey(userId), '1').catch(() => {});
    return 'granted';
  }, [userId]);

  const disableLocationSharing = useCallback(async () => {
    setShareLocation(false);
    setMyLocation(null);
    if (userId) await AsyncStorage.removeItem(shareKey(userId)).catch(() => {});
  }, [userId]);

  const reconnect = useCallback(() => setConnectAttempt((n) => n + 1), []);

  return (
    <PresenceContext.Provider
      value={{
        onlineUsers,
        status,
        shareLocation,
        myLocation,
        enableLocationSharing,
        disableLocationSharing,
        refreshLocation,
        reconnect,
      }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('usePresence must be used inside <PresenceProvider>');
  return ctx;
}

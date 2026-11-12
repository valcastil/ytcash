import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BitcoinColors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import {
  APP_LOCK_GRACE_MS,
  authenticate,
  isAppLockSuspended,
  isBiometricLockActive,
} from '@/services/biometrics';

/**
 * Covers the app with a lock screen until the person passes the device's
 * fingerprint / face check. Locks when the app starts and when it comes back
 * after more than APP_LOCK_GRACE_MS in the background.
 */
export function AppLock({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const userId = user?.id ?? null;

  const [locked, setLocked] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const promptingRef = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    setPrompting(true);
    try {
      if (await authenticate('Unlock YTCash')) setLocked(false);
    } finally {
      promptingRef.current = false;
      setPrompting(false);
    }
  }, []);

  const lockIfNeeded = useCallback(async () => {
    if (await isBiometricLockActive(userId)) {
      setLocked(true);
      unlock();
    }
  }, [userId, unlock]);

  // Lock on start, and whenever a different person signs in. Signing out clears it.
  useEffect(() => {
    if (!userId) {
      setLocked(false);
      return;
    }
    lockIfNeeded();
  }, [userId, lockIfNeeded]);

  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        // The fingerprint prompt, camera and ID scan also background the app; those do not count.
        if (!isAppLockSuspended() && !promptingRef.current) backgroundedAt.current = Date.now();
      } else if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since !== null && Date.now() - since > APP_LOCK_GRACE_MS && !isAppLockSuspended()) {
          lockIfNeeded();
        }
      }
    });
    return () => sub.remove();
  }, [userId, lockIfNeeded]);

  return (
    <View style={styles.fill}>
      {children}
      {locked && (
        <View style={styles.overlay} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={30} color={BitcoinColors.orange} />
          </View>
          <Text style={styles.title}>YTCash is locked</Text>
          <Text style={styles.body}>Use your fingerprint, face or phone passcode to open your wallet.</Text>

          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={unlock}
            disabled={prompting}
            activeOpacity={0.85}
            accessibilityRole="button">
            {prompting ? (
              <ActivityIndicator size="small" color="#07090E" />
            ) : (
              <Ionicons name="finger-print" size={18} color="#07090E" />
            )}
            <Text style={styles.unlockText}>Unlock</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => signOut().catch(() => {})} style={styles.signOutBtn} accessibilityRole="button">
            <Text style={styles.signOutText}>Sign out instead</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BitcoinColors.darkBg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    zIndex: 1000,
    elevation: 1000,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    backgroundColor: BitcoinColors.orange,
  },
  unlockText: { fontSize: 15, fontWeight: '800', color: '#07090E' },
  signOutBtn: { marginTop: 20, padding: 8 },
  signOutText: { fontSize: 13, fontWeight: '700', color: BitcoinColors.textSecondary },
});

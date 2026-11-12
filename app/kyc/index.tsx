import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import {
  getBiometricSupport,
  isBiometricLockEnabled,
  setBiometricLock,
  withAppLockSuspended,
  type BiometricSupport,
} from '@/services/biometrics';
import { launchDidit } from '@/services/didit';
import {
  getLatestVerification,
  isKycAdmin,
  kycErrorMessage,
  listPendingReviews,
  refreshKyc,
  startKyc,
  type KycVerification,
} from '@/services/kyc';

type Phase = 'verified' | 'in_review' | 'draft' | 'declined' | 'none';

export default function KycScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const userId = user?.id ?? null;
  const verified = profile?.kyc_verified ?? false;

  const [latest, setLatest] = useState<KycVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [biometrics, setBiometrics] = useState<BiometricSupport | null>(null);
  const [lockOn, setLockOn] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [verification, isAdmin, support, lock] = await Promise.all([
        getLatestVerification(userId).catch(() => null),
        isKycAdmin(),
        getBiometricSupport(),
        isBiometricLockEnabled(userId),
      ]);
      setLatest(verification);
      setAdmin(isAdmin);
      setBiometrics(support);
      setLockOn(lock);
      if (isAdmin) setPendingCount((await listPendingReviews().catch(() => [])).length);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshProfile();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  /** Pulls the newest result from the provider, then reloads everything shown here. */
  async function syncStatus() {
    await refreshKyc();
    await Promise.all([load(), refreshProfile()]);
  }

  async function onRefresh() {
    setRefreshing(true);
    await syncStatus();
    setRefreshing(false);
  }

  async function handleStart() {
    if (busy) return;
    setBusy(true);
    try {
      const start = await startKyc();
      if (start.mode === 'verified') {
        await syncStatus();
        return;
      }
      if (start.mode === 'manual') {
        router.push('/kyc/manual');
        return;
      }

      const outcome = await withAppLockSuspended(() => launchDidit(start.sessionToken, start.url));
      if (outcome.type === 'failed') {
        Alert.alert('Verification not completed', outcome.message);
      }
      if (outcome.type !== 'cancelled') await syncStatus();
      else await load();
    } catch (e) {
      Alert.alert('Could not start verification', kycErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckStatus() {
    if (busy) return;
    setBusy(true);
    try {
      await syncStatus();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleLock(next: boolean) {
    if (!userId || lockBusy) return;
    if (next && biometrics && !biometrics.enrolled) {
      Alert.alert(
        'Set up a fingerprint or face first',
        "Add one in your phone's security settings, then turn this on.",
      );
      return;
    }
    setLockBusy(true);
    try {
      setLockOn(await setBiometricLock(userId, next));
    } finally {
      setLockBusy(false);
    }
  }

  const phase: Phase = verified
    ? 'verified'
    : latest?.status === 'pending_review'
    ? 'in_review'
    : latest?.status === 'started' && latest.method === 'manual'
    ? 'draft'
    : latest?.status === 'declined'
    ? 'declined'
    : 'none';

  const status = STATUS[phase];
  const lockLabel = biometrics?.label ?? 'Fingerprint';
  const lockActive = lockOn && Boolean(biometrics?.enrolled);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Identity Verification" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BitcoinColors.orange}
            colors={[BitcoinColors.orange]}
          />
        }>
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : (
          <>
            {/* Status */}
            <View style={[styles.card, styles.statusCard, { borderColor: status.color + '55' }]}>
              <View style={[styles.statusIcon, { backgroundColor: status.color + '1F', borderColor: status.color + '55' }]}>
                <Ionicons name={status.icon} size={26} color={status.color} />
              </View>
              <Text style={styles.statusTitle}>{status.title}</Text>
              <Text style={styles.statusBody}>
                {phase === 'declined' && latest?.review_note ? latest.review_note : status.body}
              </Text>
              {latest?.is_test && latest.method === 'didit' && (
                <View style={styles.testPill}>
                  <Text style={styles.testPillText}>TEST MODE · simulated result</Text>
                </View>
              )}
            </View>

            {/* Step 1: ID + face */}
            <View style={styles.card}>
              <StepHeader number={1} title="ID and face check" done={phase === 'verified'} />
              <Text style={styles.body}>
                {phase === 'verified'
                  ? 'Your government ID and face have been checked.'
                  : phase === 'in_review'
                  ? latest?.method === 'manual'
                    ? 'Your ID photos and selfie are with our review team. You will see the result here.'
                    : 'Your scan is being reviewed. This usually finishes on its own.'
                  : 'Scan a government ID, then take a selfie so we can match your face to it. Have your ID ready and find good light.'}
              </Text>

              {(phase === 'none' || phase === 'declined' || phase === 'draft') && (
                <PrimaryButton
                  label={phase === 'draft' ? 'Continue verification' : phase === 'declined' ? 'Try again' : 'Start verification'}
                  busy={busy}
                  onPress={phase === 'draft' ? () => router.push('/kyc/manual') : handleStart}
                />
              )}
              {phase === 'in_review' && (
                <TouchableOpacity style={styles.outlineBtn} onPress={handleCheckStatus} disabled={busy} activeOpacity={0.8}>
                  {busy ? (
                    <ActivityIndicator size="small" color={BitcoinColors.orange} />
                  ) : (
                    <Ionicons name="refresh" size={15} color={BitcoinColors.orange} />
                  )}
                  <Text style={styles.outlineBtnText}>Check status</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Step 2: device biometrics */}
            <View style={styles.card}>
              <StepHeader number={2} title={`${lockLabel} app lock`} done={lockActive} />
              {biometrics?.available ? (
                <>
                  <View style={styles.lockRow}>
                    <Text style={[styles.body, styles.lockText]}>
                      {biometrics.enrolled
                        ? `Ask for your ${lockLabel.toLowerCase()} to open YTCash and to confirm sending or receiving money. It is checked by your phone and never leaves it.`
                        : "Set up a fingerprint or face in your phone's security settings to lock YTCash and confirm payments."}
                    </Text>
                    {lockBusy ? (
                      <ActivityIndicator color={BitcoinColors.orange} />
                    ) : (
                      <Switch
                        value={lockActive}
                        onValueChange={handleToggleLock}
                        trackColor={{ false: BitcoinColors.border, true: 'rgba(16, 185, 129, 0.5)' }}
                        thumbColor={lockActive ? BitcoinColors.green : '#CBD5E1'}
                        accessibilityLabel={`${lockLabel} app lock`}
                      />
                    )}
                  </View>
                </>
              ) : (
                <Text style={styles.body}>
                  This device has no fingerprint or face sensor, so the app lock is not available here.
                </Text>
              )}
            </View>

            {/* Admin */}
            {admin && (
              <TouchableOpacity
                style={[styles.card, styles.adminCard]}
                onPress={() => router.push('/kyc/review')}
                activeOpacity={0.8}
                accessibilityRole="button">
                <View style={styles.adminIcon}>
                  <Ionicons name="shield-checkmark" size={20} color={BitcoinColors.cyan} />
                </View>
                <View style={styles.adminTextWrap}>
                  <Text style={styles.adminTitle}>Review submissions</Text>
                  <Text style={styles.adminSub}>
                    {pendingCount === 0 ? 'Nothing waiting' : `${pendingCount} waiting for review`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={BitcoinColors.textMuted} />
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const STATUS: Record<Phase, { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; body: string }> = {
  verified: {
    icon: 'shield-checkmark',
    color: BitcoinColors.green,
    title: 'Verified',
    body: 'Your identity is confirmed.',
  },
  in_review: {
    icon: 'time',
    color: BitcoinColors.cyan,
    title: 'In review',
    body: 'We have your documents. You do not need to do anything right now.',
  },
  draft: {
    icon: 'document-text',
    color: BitcoinColors.orange,
    title: 'Not finished',
    body: 'You started verifying but have not submitted yet.',
  },
  declined: {
    icon: 'close-circle',
    color: BitcoinColors.red,
    title: 'Not approved',
    body: 'We could not confirm your identity from the last attempt.',
  },
  none: {
    icon: 'shield-outline',
    color: BitcoinColors.orange,
    title: 'Not verified yet',
    body: 'Verify your identity to keep your wallet and the people you pay safe.',
  },
};

function StepHeader({ number, title, done }: { number: number; title: string; done: boolean }) {
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
        {done ? (
          <Ionicons name="checkmark" size={14} color="#07090E" />
        ) : (
          <Text style={styles.stepNumber}>{number}</Text>
        )}
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
    </View>
  );
}

function PrimaryButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
      <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
        {busy && <ActivityIndicator size="small" color="#07090E" />}
        <Text style={styles.primaryBtnText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  scroll: { padding: 20, paddingBottom: 40 },
  loader: { marginTop: 40 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  statusCard: { alignItems: 'center', paddingVertical: 24 },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 12,
  },
  statusTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  statusBody: {
    fontSize: 13,
    lineHeight: 19,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  testPill: {
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  testPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: BitcoinColors.gold },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
  },
  stepBadgeDone: { backgroundColor: BitcoinColors.green, borderColor: BitcoinColors.green },
  stepNumber: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  stepTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  body: { fontSize: 13, lineHeight: 19, color: '#E2E8F0' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lockText: { flex: 1 },
  primaryBtn: { marginTop: 16, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(247, 147, 26, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.35)',
  },
  outlineBtnText: { fontSize: 12, fontWeight: '800', color: BitcoinColors.orange },
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderColor: 'rgba(6, 182, 212, 0.35)',
  },
  adminIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  adminTextWrap: { flex: 1 },
  adminTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  adminSub: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
});

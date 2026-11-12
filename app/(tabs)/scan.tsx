import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/contexts/auth';
import { BitcoinColors, Brand } from '@/constants/theme';
import { CURRENCIES, formatCurrency, phpToSats, phpToBtc } from '@/constants/currencies';
import {
  detectCurrency,
  aggregateNotes,
  type DetectedNote,
} from '@/services/cash-scanner';
import { getPhpEquivalent } from '@/services/currency-api';
import { confirmWithBiometrics } from '@/services/biometrics';
import { addScannedCash, walletErrorMessage, type ScannedNoteInput } from '@/services/supabase';
import { BitcoinBadge } from '@/components/bitcoin-badge';

type ScanPhase = 'camera' | 'processing' | 'results';

export default function CashScannerScreen() {
  const { user, refreshProfile } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<ScanPhase>('camera');
  const [detectedNotes, setDetectedNotes] = useState<DetectedNote[]>([]);
  const [, setTotals] = useState<Record<string, number>>({});
  const [phpTotal, setPhpTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <BitcoinBadge size={56} glow={true} />
        <Text style={styles.permissionTitle}>Optical Cash Scanner Access</Text>
        <Text style={styles.permissionText}>
          Position banknotes in front of your camera to digitize cash directly into Bitcoin & Satoshi credits.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission} activeOpacity={0.85}>
          <LinearGradient colors={Brand.gradientButton} style={styles.btnGradient}>
            <Text style={styles.permissionBtnText}>Enable Camera</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  async function captureAndDetect() {
    if (!cameraRef.current) return;

    setPhase('processing');
    setLoading(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.8,
      });

      if (!photo?.base64) {
        throw new Error('Failed to capture photo');
      }

      const notes = await detectCurrency(photo.base64);

      if (notes.length === 0) {
        Alert.alert('No Currency Detected', 'Please align the banknote clearly inside the reticle.');
        setPhase('camera');
        return;
      }

      const aggregated = aggregateNotes(notes);

      let totalPhp = 0;
      for (const [currency, amount] of Object.entries(aggregated)) {
        const { phpAmount } = await getPhpEquivalent(amount, currency);
        totalPhp += phpAmount;
      }

      setDetectedNotes(notes);
      setTotals(aggregated);
      setPhpTotal(totalPhp);
      setPhase('results');
    } catch (err: any) {
      Alert.alert('Scan Failed', err.message ?? 'Something went wrong. Please try again.');
      setPhase('camera');
    } finally {
      setLoading(false);
    }
  }

  async function addToWallet() {
    if (!user) return;
    if (!(await confirmWithBiometrics(user.id, 'Confirm adding this cash to your wallet'))) return;
    setLoading(true);

    try {
      const notes: ScannedNoteInput[] = [];
      for (const note of detectedNotes) {
        if (note.currency === 'UNKNOWN' || note.denomination <= 0) continue;
        const { rate } = await getPhpEquivalent(note.denomination, note.currency);
        notes.push({ currency: note.currency, denomination: note.denomination, rate });
      }

      // The server validates each note and works out the amount it credits.
      const tx = await addScannedCash(notes);
      const credited = tx?.amount ?? phpTotal;

      await refreshProfile();

      Alert.alert(
        'Cash Digitized to Wallet!',
        `${formatCurrency(credited)} (${phpToSats(credited).toLocaleString()} sats) has been added to your balance.`,
        [{ text: 'OK', onPress: () => setPhase('camera') }],
      );

      setDetectedNotes([]);
      setTotals({});
      setPhpTotal(0);
    } catch (err: any) {
      Alert.alert('Could Not Add Cash', walletErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (phase === 'processing') {
    return (
      <View style={styles.processingContainer}>
        <BitcoinBadge size={64} glow={true} />
        <ActivityIndicator size="large" color={BitcoinColors.orange} style={{ marginTop: 20 }} />
        <Text style={styles.processingText}>Neural Cash Recognition</Text>
        <Text style={styles.processingSub}>Analyzing banknote security features & denomination</Text>
      </View>
    );
  }

  if (phase === 'results') {
    const satsEquiv = phpToSats(phpTotal);
    const btcEquiv = phpToBtc(phpTotal);

    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.resultsContainer}>
        <View style={styles.resultsHeader}>
          <BitcoinBadge size={52} glow={true} />
          <Text style={styles.resultsTitle}>Currency Recognized!</Text>
          <Text style={styles.resultsSub}>Ready to settle into your digital balance</Text>
        </View>

        {/* Total Value Hero Box */}
        <View style={styles.phpTotalCard}>
          <Text style={styles.phpTotalLabel}>DIGITIZED VALUE</Text>
          <Text style={styles.phpTotalAmount}>{formatCurrency(phpTotal)}</Text>
          <View style={styles.resultsSatsRow}>
            <Text style={styles.resultsSatsIcon}>⚡</Text>
            <Text style={styles.resultsSatsValue}>{satsEquiv.toLocaleString()} SATS</Text>
            <Text style={styles.resultsBtcValue}>(₿{btcEquiv.toFixed(6)})</Text>
          </View>
        </View>

        {/* Detected notes breakdown */}
        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>DETECTED BANKNOTES</Text>
          {detectedNotes.map((note, i) => (
            <View key={i} style={styles.noteRow}>
              <Text style={styles.noteFlag}>{CURRENCIES[note.currency]?.flag ?? '💵'}</Text>
              <View style={styles.noteInfo}>
                <Text style={styles.noteCurrency}>
                  {CURRENCIES[note.currency]?.name ?? note.currency}
                </Text>
                <Text style={styles.noteDenom}>
                  {CURRENCIES[note.currency]?.symbol ?? ''}
                  {note.denomination.toLocaleString()}
                </Text>
              </View>
              <View style={styles.confidenceBadge}>
                <Text style={styles.noteConfidence}>{Math.round(note.confidence * 100)}% match</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Action Buttons */}
        <View style={styles.resultsButtons}>
          <TouchableOpacity
            style={styles.rescanBtn}
            onPress={() => setPhase('camera')}
            activeOpacity={0.8}>
            <Ionicons name="camera-reverse" size={20} color={BitcoinColors.textSecondary} />
            <Text style={styles.rescanBtnText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.addWalletBtn, loading && styles.btnDisabled]}
            onPress={addToWallet}
            disabled={loading}
            activeOpacity={0.85}>
            <LinearGradient colors={Brand.gradientButton} style={styles.addWalletBtnGradient}>
              <Ionicons name="flash" size={20} color="#07090E" />
              <Text style={styles.addWalletBtnText}>
                {loading ? 'Crediting...' : 'Deposit to Wallet'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Camera phase
  return (
    <View style={styles.cameraContainer}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.cameraOverlay}>
        {/* Header */}
        <View style={styles.cameraHeader}>
          <View style={styles.hudBadge}>
            <View style={styles.hudPulse} />
            <Text style={styles.hudText}>⚡ AI VISION SCANNER</Text>
          </View>
          <Text style={styles.cameraTitle}>Scan Cash</Text>
          <Text style={styles.cameraSub}>Align any supported banknote inside the reticle</Text>
        </View>

        {/* Cyberpunk Bitcoin Reticle */}
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />

          {/* Center Crosshair */}
          <View style={styles.crosshair}>
            <Ionicons name="add" size={28} color="rgba(247, 147, 26, 0.4)" />
          </View>
        </View>

        {/* Footer Controls */}
        <View style={styles.cameraFooter}>
          <View style={styles.supportedPill}>
            <Text style={styles.supportedText}>
              Supported: PHP 🇵🇭 • USD 🇺🇸 • EUR 🇪🇺 • AED 🇦🇪
            </Text>
          </View>

          <TouchableOpacity
            style={styles.captureBtn}
            onPress={captureAndDetect}
            activeOpacity={0.85}>
            <LinearGradient colors={Brand.gradientButton} style={styles.captureBtnInner}>
              <Ionicons name="scan" size={32} color="#07090E" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BitcoinColors.darkBg,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: BitcoinColors.darkBg,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 18,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  permissionBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 24,
    width: '100%',
  },
  btnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: '#07090E',
    fontSize: 15,
    fontWeight: '800',
  },
  processingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.darkBg,
    padding: 24,
  },
  processingText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 16,
  },
  processingSub: {
    fontSize: 13,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(7, 9, 14, 0.45)',
  },
  cameraHeader: {
    paddingTop: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  hudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
    gap: 6,
  },
  hudPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BitcoinColors.orange,
  },
  hudText: {
    fontSize: 10,
    fontWeight: '800',
    color: BitcoinColors.gold,
    letterSpacing: 0.5,
  },
  cameraTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  cameraSub: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 4,
  },
  scanFrame: {
    width: 310,
    height: 190,
    alignSelf: 'center',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.03)',
    borderRadius: 16,
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: BitcoinColors.orange,
    borderWidth: 3.5,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 16,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 16,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 16,
  },
  crosshair: {
    opacity: 0.8,
  },
  cameraFooter: {
    paddingBottom: 36,
    alignItems: 'center',
  },
  supportedPill: {
    backgroundColor: 'rgba(18, 23, 34, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 16,
  },
  supportedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(247, 147, 26, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(247, 147, 26, 0.5)',
  },
  captureBtnInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsContainer: {
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 40,
  },
  resultsHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  resultsTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 12,
  },
  resultsSub: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 4,
  },
  phpTotalCard: {
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    marginBottom: 16,
  },
  phpTotalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
  },
  phpTotalAmount: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    marginVertical: 4,
  },
  resultsSatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  resultsSatsIcon: {
    color: BitcoinColors.lightning,
    fontSize: 13,
  },
  resultsSatsValue: {
    color: BitcoinColors.gold,
    fontSize: 13,
    fontWeight: '800',
  },
  resultsBtcValue: {
    color: BitcoinColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  resultsCard: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 16,
  },
  resultsCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
    letterSpacing: 1,
    marginBottom: 12,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  noteFlag: {
    fontSize: 22,
    marginRight: 12,
  },
  noteInfo: {
    flex: 1,
  },
  noteCurrency: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  noteDenom: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    marginTop: 2,
  },
  confidenceBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  noteConfidence: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  resultsButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  rescanBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingVertical: 14,
    gap: 6,
  },
  rescanBtnText: {
    color: BitcoinColors.textSecondary,
    fontWeight: '700',
    fontSize: 14,
  },
  addWalletBtn: {
    flex: 2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  addWalletBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  addWalletBtnText: {
    color: '#07090E',
    fontWeight: '800',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});

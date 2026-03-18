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
import { useAuth } from '@/contexts/auth';
import { Brand } from '@/constants/theme';
import { CURRENCIES, formatCurrency } from '@/constants/currencies';
import {
  detectCurrency,
  aggregateNotes,
  imageToBase64,
  type DetectedNote,
} from '@/services/cash-scanner';
import { getPhpEquivalent } from '@/services/currency-api';
import { recordScannedCash, updateBalance, createTransaction, checkDuplicateSerial } from '@/services/supabase';

type ScanPhase = 'camera' | 'processing' | 'results';

export default function CashScannerScreen() {
  const { user, refreshProfile } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<ScanPhase>('camera');
  const [detectedNotes, setDetectedNotes] = useState<DetectedNote[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [phpTotal, setPhpTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={64} color="#E5E7EB" />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to scan banknotes. Your images are processed securely.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
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
        Alert.alert('No Currency Detected', 'Please try again with a clearer image of the banknote.');
        setPhase('camera');
        return;
      }

      const aggregated = aggregateNotes(notes);

      // Calculate PHP equivalents
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
    setLoading(true);

    try {
      // Record each detected note
      for (const note of detectedNotes) {
        if (note.currency === 'UNKNOWN' || note.denomination <= 0) continue;

        const { phpAmount, rate } = await getPhpEquivalent(note.denomination, note.currency);

        await recordScannedCash({
          user_id: user.id,
          currency: note.currency,
          denomination: note.denomination,
          serial_number: null, // OCR would fill this in a production app
          php_equivalent: phpAmount,
          exchange_rate: rate,
        });
      }

      // Credit balance
      await updateBalance(user.id, phpTotal);

      // Record transaction
      await createTransaction({
        from_user: null,
        to_user: user.id,
        amount: phpTotal,
        currency: 'PHP',
        converted_amount: phpTotal,
        converted_currency: 'PHP',
        type: 'scan',
        status: 'completed',
        note: `Cash scan: ${Object.entries(totals).map(([c, a]) => `${CURRENCIES[c]?.symbol ?? c}${a}`).join(', ')}`,
      });

      await refreshProfile();

      Alert.alert(
        'Added to Wallet!',
        `${formatCurrency(phpTotal)} has been added to your wallet.`,
        [{ text: 'OK', onPress: () => setPhase('camera') }],
      );

      setDetectedNotes([]);
      setTotals({});
      setPhpTotal(0);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to add to wallet');
    } finally {
      setLoading(false);
    }
  }

  if (phase === 'processing') {
    return (
      <View style={styles.processingContainer}>
        <ActivityIndicator size="large" color={Brand.primary} />
        <Text style={styles.processingText}>Detecting currency...</Text>
        <Text style={styles.processingSub}>Analyzing banknote with AI</Text>
      </View>
    );
  }

  if (phase === 'results') {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.resultsContainer}>
        <View style={styles.resultsHeader}>
          <Ionicons name="checkmark-circle" size={56} color="#36B37E" />
          <Text style={styles.resultsTitle}>Notes Detected!</Text>
        </View>

        {/* Detected notes breakdown */}
        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>Detected Banknotes</Text>
          {detectedNotes.map((note, i) => (
            <View key={i} style={styles.noteRow}>
              <Text style={styles.noteFlag}>{CURRENCIES[note.currency]?.flag ?? '?'}</Text>
              <View style={styles.noteInfo}>
                <Text style={styles.noteCurrency}>
                  {CURRENCIES[note.currency]?.name ?? note.currency}
                </Text>
                <Text style={styles.noteDenom}>
                  {CURRENCIES[note.currency]?.symbol ?? ''}{note.denomination}
                </Text>
              </View>
              <Text style={styles.noteConfidence}>
                {Math.round(note.confidence * 100)}%
              </Text>
            </View>
          ))}
        </View>

        {/* Totals by currency */}
        <View style={styles.resultsCard}>
          <Text style={styles.resultsCardTitle}>Totals by Currency</Text>
          {Object.entries(totals).map(([currency, total]) => (
            <View key={currency} style={styles.totalRow}>
              <Text style={styles.totalFlag}>{CURRENCIES[currency]?.flag ?? ''}</Text>
              <Text style={styles.totalCurrency}>{currency}</Text>
              <Text style={styles.totalAmount}>
                {CURRENCIES[currency]?.symbol ?? ''}{total.toLocaleString()}
              </Text>
            </View>
          ))}
        </View>

        {/* PHP Equivalent */}
        <View style={styles.phpTotalCard}>
          <Text style={styles.phpTotalLabel}>Total in PHP</Text>
          <Text style={styles.phpTotalAmount}>{formatCurrency(phpTotal)}</Text>
        </View>

        <View style={styles.resultsButtons}>
          <TouchableOpacity
            style={styles.rescanBtn}
            onPress={() => setPhase('camera')}>
            <Ionicons name="camera" size={20} color={Brand.primary} />
            <Text style={styles.rescanBtnText}>Scan Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addWalletBtn, loading && styles.btnDisabled]}
            onPress={addToWallet}
            disabled={loading}>
            <Ionicons name="wallet" size={20} color="#fff" />
            <Text style={styles.addWalletBtnText}>
              {loading ? 'Adding...' : 'Add to Wallet'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Camera phase
  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back">
        {/* Overlay */}
        <View style={styles.cameraOverlay}>
          <View style={styles.cameraHeader}>
            <Text style={styles.cameraTitle}>Scan Banknote</Text>
            <Text style={styles.cameraSub}>
              Position the banknote within the frame
            </Text>
          </View>

          {/* Scan frame */}
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>

          <View style={styles.cameraFooter}>
            <Text style={styles.supportedText}>
              Supported: PHP, USD, EUR, AED
            </Text>
            <TouchableOpacity style={styles.captureBtn} onPress={captureAndDetect}>
              <View style={styles.captureBtnInner}>
                <Ionicons name="scan" size={32} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F5' },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginTop: 16 },
  permissionText: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  permissionBtn: { backgroundColor: Brand.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 },
  permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  processingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  processingText: { fontSize: 18, fontWeight: '700', color: '#1A1A2E', marginTop: 20 },
  processingSub: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.3)' },
  cameraHeader: { paddingTop: 60, paddingHorizontal: 20, alignItems: 'center' },
  cameraTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  cameraSub: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  scanFrame: { width: 300, height: 180, alignSelf: 'center', position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#F7931A', borderWidth: 3 },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  cameraFooter: { paddingBottom: 40, alignItems: 'center' },
  supportedText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16 },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsContainer: { paddingBottom: 40 },
  resultsHeader: { alignItems: 'center', paddingTop: 40, marginBottom: 20 },
  resultsTitle: { fontSize: 24, fontWeight: '800', color: '#1A1A2E', marginTop: 12 },
  resultsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  resultsCardTitle: { fontSize: 15, fontWeight: '700', color: '#6B7280', marginBottom: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  noteFlag: { fontSize: 24, marginRight: 12 },
  noteInfo: { flex: 1 },
  noteCurrency: { fontSize: 14, fontWeight: '600', color: '#1A1A2E' },
  noteDenom: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  noteConfidence: { fontSize: 13, fontWeight: '600', color: '#22C55E' },
  totalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  totalFlag: { fontSize: 20, marginRight: 10 },
  totalCurrency: { fontSize: 15, fontWeight: '600', color: '#1A1A2E', flex: 1 },
  totalAmount: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  phpTotalCard: {
    backgroundColor: Brand.primary,
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  phpTotalLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  phpTotalAmount: { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4 },
  resultsButtons: { flexDirection: 'row', paddingHorizontal: 20, gap: 12 },
  rescanBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: Brand.primary,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rescanBtnText: { fontSize: 15, fontWeight: '700', color: Brand.primary },
  addWalletBtn: {
    flex: 1,
    backgroundColor: '#22C55E',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addWalletBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.6 },
});

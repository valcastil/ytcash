import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/theme';

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="qr-code-outline" size={64} color="#DFE1E6" />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to scan QR codes for payments.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    // Parse QR data — format: ytcash://pay?to=USER_ID&amount=100&currency=PHP
    try {
      if (data.startsWith('ytcash://')) {
        const url = new URL(data);
        const to = url.searchParams.get('to');
        const amount = url.searchParams.get('amount');
        Alert.alert(
          'Payment QR Detected',
          `Pay ${amount ? `₱${amount}` : 'an amount'} to user?`,
          [
            { text: 'Cancel', onPress: () => setScanned(false) },
            { text: 'Pay', onPress: () => { router.push('/(tabs)/send'); } },
          ],
        );
      } else {
        Alert.alert('QR Code Scanned', data, [
          { text: 'OK', onPress: () => setScanned(false) },
        ]);
      }
    } catch {
      Alert.alert('QR Code', data, [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    }
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}>
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.centerArea}>
            <Text style={styles.scanTitle}>Scan QR Code</Text>
            <Text style={styles.scanSub}>Point your camera at a YTCash QR code</Text>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
          </View>

          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.myQrBtn} onPress={() => Alert.alert('My QR', 'Your personal QR code feature coming soon!')}>
              <Ionicons name="qr-code" size={22} color="#fff" />
              <Text style={styles.myQrText}>My QR Code</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#F5F5F5' },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginTop: 16 },
  permissionText: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  permissionBtn: { backgroundColor: Brand.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 },
  permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  overlay: { flex: 1, justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.4)' },
  topBar: { paddingTop: 56, paddingHorizontal: 20 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  centerArea: { alignItems: 'center' },
  scanTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  scanSub: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 24 },
  scanFrame: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: Brand.primaryLight, borderWidth: 3 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  bottomBar: { paddingBottom: 50, alignItems: 'center' },
  myQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  myQrText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

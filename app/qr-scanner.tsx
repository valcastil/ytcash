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
import { LinearGradient } from 'expo-linear-gradient';
import { BitcoinColors, Brand } from '@/constants/theme';
import { BitcoinBadge } from '@/components/bitcoin-badge';

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <BitcoinBadge size={56} glow={true} />
        <Text style={styles.permissionTitle}>QR Camera Permission</Text>
        <Text style={styles.permissionText}>
          Camera access is required to scan Bitcoin Lightning and YTCash payment invoices.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission} activeOpacity={0.85}>
          <LinearGradient colors={Brand.gradientButton} style={styles.btnGradient}>
            <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);

    try {
      if (data.startsWith('ytcash://')) {
        const url = new URL(data);
        const to = url.searchParams.get('to');
        const amount = url.searchParams.get('amount');
        Alert.alert(
          'Payment Request Detected',
          `Pay ${amount ? `₱${amount}` : 'an amount'} via Bitcoin network?`,
          [
            { text: 'Cancel', onPress: () => setScanned(false) },
            {
              text: 'Proceed to Pay',
              onPress: () => {
                router.push('/(tabs)/send');
              },
            },
          ],
        );
      } else if (data.toLowerCase().startsWith('lightning:') || data.toLowerCase().startsWith('lnbc')) {
        Alert.alert('Lightning Invoice Detected', `Invoice: ${data.substring(0, 32)}...`, [
          { text: 'Cancel', onPress: () => setScanned(false) },
          { text: 'Pay Invoice', onPress: () => router.push('/(tabs)/send') },
        ]);
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
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      <View style={styles.overlay}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.hudBadge}>
            <View style={styles.hudPulse} />
            <Text style={styles.hudText}>⚡ LIGHTNING QR</Text>
          </View>

          <View style={{ width: 40 }} />
        </View>

        {/* Center Scan Area */}
        <View style={styles.centerArea}>
          <Text style={styles.scanTitle}>Scan Payment QR</Text>
          <Text style={styles.scanSub}>Point at any Bitcoin Lightning or YTCash code</Text>

          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />

            <View style={styles.crosshair}>
              <Ionicons name="scan-outline" size={48} color="rgba(247, 147, 26, 0.45)" />
            </View>
          </View>
        </View>

        {/* Bottom Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.myQrBtn}
            onPress={() =>
              Alert.alert('Personal Receive QR', 'Your lightning address and payment QR are active.')
            }
            activeOpacity={0.8}>
            <Ionicons name="qr-code" size={20} color={BitcoinColors.orange} />
            <Text style={styles.myQrText}>Receive via My QR</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(7, 9, 14, 0.55)',
  },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  hudPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BitcoinColors.orange,
  },
  hudText: {
    fontSize: 11,
    fontWeight: '800',
    color: BitcoinColors.gold,
  },
  centerArea: {
    alignItems: 'center',
  },
  scanTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  scanSub: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    marginBottom: 28,
  },
  scanFrame: {
    width: 250,
    height: 250,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(247, 147, 26, 0.03)',
    borderRadius: 20,
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: BitcoinColors.orange,
    borderWidth: 3.5,
  },
  tl: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 20,
  },
  tr: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 20,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 20,
  },
  br: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 20,
  },
  crosshair: {
    opacity: 0.8,
  },
  bottomBar: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  myQrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BitcoinColors.cardElevated,
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.4)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  myQrText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

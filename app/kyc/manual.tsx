import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors, Brand } from '@/constants/theme';
import { useAuth } from '@/contexts/auth';
import { withAppLockSuspended } from '@/services/biometrics';
import {
  DOCUMENT_TYPES,
  kycErrorMessage,
  startManualKyc,
  submitManualKyc,
  uploadKycImage,
  validateDateOfBirth,
  type KycDocumentType,
  type KycImageKind,
  type KycVerification,
} from '@/services/kyc';

interface Photo {
  /** Local preview. */
  uri: string;
  /** Where it was stored, once the upload finishes. */
  path: string | null;
  uploading: boolean;
}

const PHOTO_COPY: Record<KycImageKind, { title: string; hint: string; icon: keyof typeof Ionicons.glyphMap }> = {
  front: { title: 'Front of ID', hint: 'All four corners visible, no glare', icon: 'card-outline' },
  back: { title: 'Back of ID', hint: 'Same ID, other side', icon: 'card-outline' },
  selfie: { title: 'Selfie', hint: 'Face the camera, no hat or sunglasses', icon: 'happy-outline' },
};

export default function ManualKycScreen() {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  const [verification, setVerification] = useState<KycVerification | null>(null);
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [legalName, setLegalName] = useState(profile?.full_name ?? '');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [documentType, setDocumentType] = useState<KycDocumentType>('national_id');
  const [photos, setPhotos] = useState<Partial<Record<KycImageKind, Photo>>>({});
  const [submitting, setSubmitting] = useState(false);

  const needsBack = DOCUMENT_TYPES.find((d) => d.value === documentType)?.hasBack ?? true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await startManualKyc();
        if (!cancelled) setVerification(v);
      } catch (e) {
        if (!cancelled) setOpenError(kycErrorMessage(e));
      } finally {
        if (!cancelled) setOpening(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onDobChange(text: string) {
    // Insert the dashes as the digits are typed: 19900501 -> 1990-05-01
    const digits = text.replace(/[^\d]/g, '').slice(0, 8);
    const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean);
    setDateOfBirth(parts.join('-'));
  }

  async function capture(kind: KycImageKind) {
    if (!userId || !verification) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access for YTCash in your settings to take this photo.');
      return;
    }

    // Camera only: photos must be taken now, not picked from the gallery.
    const result = await withAppLockSuspended(() =>
      ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: kind === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        quality: 0.5,
        base64: true,
        exif: false,
      }),
    );
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;

    setPhotos((p) => ({ ...p, [kind]: { uri: asset.uri, path: null, uploading: true } }));
    try {
      const path = await uploadKycImage(userId, verification.id, kind, asset.base64);
      setPhotos((p) => ({ ...p, [kind]: { uri: asset.uri, path, uploading: false } }));
    } catch (e) {
      setPhotos((p) => {
        const next = { ...p };
        delete next[kind];
        return next;
      });
      Alert.alert('Upload failed', kycErrorMessage(e));
    }
  }

  function validate(): string | null {
    if (legalName.trim().length < 3) return 'Enter your full legal name as it appears on your ID.';
    const dobProblem = validateDateOfBirth(dateOfBirth);
    if (dobProblem) return dobProblem;
    if (!photos.front?.path) return 'Take a photo of the front of your ID.';
    if (needsBack && !photos.back?.path) return 'Take a photo of the back of your ID.';
    if (!photos.selfie?.path) return 'Take a selfie.';
    if (Object.values(photos).some((p) => p?.uploading)) return 'Wait for the photos to finish uploading.';
    return null;
  }

  async function handleSubmit() {
    if (!verification || submitting) return;
    const problem = validate();
    if (problem) {
      Alert.alert('Almost there', problem);
      return;
    }
    setSubmitting(true);
    try {
      await submitManualKyc({
        verificationId: verification.id,
        legalName: legalName.trim(),
        dateOfBirth,
        documentType,
        idFrontPath: photos.front!.path!,
        idBackPath: needsBack ? photos.back?.path ?? null : null,
        selfiePath: photos.selfie!.path!,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not submit', kycErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (opening || openError || !verification) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Verify Your Identity" />
        {opening ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : (
          <View style={styles.messageCard}>
            <Ionicons name="information-circle-outline" size={28} color={BitcoinColors.textSecondary} />
            <Text style={styles.messageText}>{openError ?? 'Verification could not be started.'}</Text>
          </View>
        )}
      </View>
    );
  }

  const kinds: KycImageKind[] = needsBack ? ['front', 'back', 'selfie'] : ['front', 'selfie'];

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Verify Your Identity" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>FULL LEGAL NAME</Text>
          <TextInput
            style={styles.input}
            value={legalName}
            onChangeText={setLegalName}
            placeholder="As shown on your ID"
            placeholderTextColor={BitcoinColors.textMuted}
            autoCapitalize="words"
            maxLength={120}
          />

          <Text style={[styles.label, styles.labelSpaced]}>DATE OF BIRTH</Text>
          <TextInput
            style={styles.input}
            value={dateOfBirth}
            onChangeText={onDobChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={BitcoinColors.textMuted}
            keyboardType="number-pad"
            maxLength={10}
            accessibilityLabel="Date of birth, year month day"
          />

          <Text style={[styles.label, styles.labelSpaced]}>ID TYPE</Text>
          <View style={styles.chips}>
            {DOCUMENT_TYPES.map((doc) => {
              const selected = doc.value === documentType;
              return (
                <TouchableOpacity
                  key={doc.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setDocumentType(doc.value)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{doc.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>PHOTOS</Text>
          {kinds.map((kind) => {
            const photo = photos[kind];
            const copy = PHOTO_COPY[kind];
            return (
              <TouchableOpacity
                key={kind}
                style={[styles.photoRow, photo?.path && styles.photoRowDone]}
                onPress={() => capture(kind)}
                disabled={photo?.uploading}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${photo ? 'Retake' : 'Take'} photo: ${copy.title}`}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Ionicons name={copy.icon} size={24} color={BitcoinColors.orange} />
                  </View>
                )}
                <View style={styles.photoTextWrap}>
                  <Text style={styles.photoTitle}>{copy.title}</Text>
                  <Text style={styles.photoHint}>
                    {photo?.uploading ? 'Uploading…' : photo?.path ? 'Saved. Tap to retake.' : copy.hint}
                  </Text>
                </View>
                {photo?.uploading ? (
                  <ActivityIndicator size="small" color={BitcoinColors.orange} />
                ) : (
                  <Ionicons
                    name={photo?.path ? 'checkmark-circle' : 'camera'}
                    size={22}
                    color={photo?.path ? BitcoinColors.green : BitcoinColors.orange}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="lock-closed" size={16} color={BitcoinColors.orange} />
          <Text style={styles.infoText}>
            Your photos are stored privately and are only seen by the YTCash team member who checks your
            identity. A person compares your selfie with your ID.
          </Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting} activeOpacity={0.85}>
          <LinearGradient colors={Brand.gradientButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtnGradient}>
            {submitting && <ActivityIndicator size="small" color="#07090E" />}
            <Text style={styles.primaryBtnText}>{submitting ? 'Submitting…' : 'Submit for review'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BitcoinColors.darkBg },
  loader: { marginTop: 40 },
  scroll: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 12,
  },
  messageCard: {
    margin: 20,
    padding: 24,
    borderRadius: 18,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
    gap: 12,
  },
  messageText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, textAlign: 'center' },
  label: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1, marginBottom: 8 },
  labelSpaced: { marginTop: 18 },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  chipSelected: { backgroundColor: 'rgba(247, 147, 26, 0.16)', borderColor: 'rgba(247, 147, 26, 0.5)' },
  chipText: { fontSize: 12, fontWeight: '700', color: BitcoinColors.textSecondary },
  chipTextSelected: { color: BitcoinColors.orange },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: BitcoinColors.darkBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    marginBottom: 8,
  },
  photoRowDone: { borderColor: 'rgba(16, 185, 129, 0.4)' },
  thumb: { width: 64, height: 48, borderRadius: 8, backgroundColor: BitcoinColors.cardElevated },
  thumbEmpty: { justifyContent: 'center', alignItems: 'center' },
  photoTextWrap: { flex: 1 },
  photoTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  photoHint: { fontSize: 12, color: BitcoinColors.textSecondary, marginTop: 2 },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 147, 26, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 147, 26, 0.25)',
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#E2E8F0' },
  primaryBtn: { marginTop: 16, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
});

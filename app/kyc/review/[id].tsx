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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/screen-header';
import { BitcoinColors } from '@/constants/theme';
import {
  documentTypeLabel,
  getDocumentUrls,
  getVerification,
  kycErrorMessage,
  reviewVerification,
  type KycImageKind,
  type KycVerification,
} from '@/services/kyc';

const PHOTO_LABELS: Record<KycImageKind, string> = {
  front: 'Front of ID',
  back: 'Back of ID',
  selfie: 'Selfie',
};

const CHECKLIST = [
  'The ID is a real government document, not a photo of a screen or a photocopy.',
  'The name and date of birth on the ID match what was typed.',
  'The selfie is clearly the same person as the ID photo.',
  'The ID is not expired and nothing looks edited.',
];

export default function KycReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<KycVerification | null>(null);
  const [urls, setUrls] = useState<Partial<Record<KycImageKind, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const verification = id ? await getVerification(id) : null;
        if (cancelled) return;
        setItem(verification);
        if (verification) {
          const links = await getDocumentUrls(verification);
          if (!cancelled) setUrls(links);
        }
      } catch (e) {
        if (!cancelled) setError(kycErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function decide(approve: boolean) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await reviewVerification(item.id, approve, approve ? undefined : reason);
      router.back();
    } catch (e) {
      Alert.alert('Could not save decision', kycErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmApprove() {
    Alert.alert(
      'Approve this person?',
      `${item?.legal_name ?? 'This user'} will be marked as verified.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Approve', onPress: () => decide(true) },
      ],
    );
  }

  function submitReject() {
    if (reason.trim().length < 5) {
      Alert.alert('Add a reason', 'Tell the user what to fix, for example "Selfie is too dark".');
      return;
    }
    decide(false);
  }

  if (loading || !item) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Review" />
        {loading ? (
          <ActivityIndicator color={BitcoinColors.orange} style={styles.loader} />
        ) : (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>{error ?? 'This submission could not be found.'}</Text>
          </View>
        )}
      </View>
    );
  }

  const open = item.status === 'pending_review';
  const kinds = (['front', 'back', 'selfie'] as const).filter((kind) =>
    kind === 'front' ? item.id_front_path : kind === 'back' ? item.id_back_path : item.selfie_path,
  );

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Review" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>WHAT THE USER ENTERED</Text>
          <DetailRow label="Legal name" value={item.legal_name ?? ''} />
          <DetailRow label="Date of birth" value={item.date_of_birth ?? ''} />
          <DetailRow label="ID type" value={documentTypeLabel(item.document_type)} />
        </View>

        {kinds.map((kind) => (
          <View key={kind} style={styles.card}>
            <Text style={styles.label}>{PHOTO_LABELS[kind].toUpperCase()}</Text>
            {urls[kind] ? (
              <Image
                source={{ uri: urls[kind] }}
                style={[styles.photo, kind === 'selfie' && styles.photoSelfie]}
                resizeMode="contain"
                accessibilityLabel={PHOTO_LABELS[kind]}
              />
            ) : (
              <Text style={styles.photoMissing}>This photo could not be loaded.</Text>
            )}
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.label}>BEFORE YOU APPROVE</Text>
          {CHECKLIST.map((line) => (
            <View key={line} style={styles.checkRow}>
              <Ionicons name="ellipse" size={6} color={BitcoinColors.textSecondary} style={styles.checkDot} />
              <Text style={styles.checkText}>{line}</Text>
            </View>
          ))}
        </View>

        {!open ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>This submission was already {item.status}.</Text>
          </View>
        ) : rejecting ? (
          <View style={styles.card}>
            <Text style={styles.label}>REASON (SHOWN TO THE USER)</Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="What should they fix?"
              placeholderTextColor={BitcoinColors.textMuted}
              multiline
              maxLength={300}
              autoFocus
            />
            <View style={styles.buttons}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRejecting(false)} disabled={busy} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={submitReject} disabled={busy} activeOpacity={0.85}>
                {busy && <ActivityIndicator size="small" color="#FFFFFF" />}
                <Text style={styles.rejectText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.actionBtn, styles.rejectOutline]} onPress={() => setRejecting(true)} disabled={busy} activeOpacity={0.85}>
              <Text style={styles.rejectOutlineText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={confirmApprove} disabled={busy} activeOpacity={0.85}>
              {busy && <ActivityIndicator size="small" color="#07090E" />}
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
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
  messageCard: {
    margin: 20,
    padding: 20,
    borderRadius: 18,
    backgroundColor: BitcoinColors.cardBg,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    alignItems: 'center',
  },
  messageText: { fontSize: 13, lineHeight: 19, color: BitcoinColors.textSecondary, textAlign: 'center' },
  label: { fontSize: 11, fontWeight: '800', color: BitcoinColors.textSecondary, letterSpacing: 1, marginBottom: 10 },
  detailRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  detailLabel: { width: 100, fontSize: 12, color: BitcoinColors.textMuted },
  detailValue: { flex: 1, fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  photo: { width: '100%', aspectRatio: 1.5, borderRadius: 12, backgroundColor: BitcoinColors.void },
  photoSelfie: { aspectRatio: 0.9 },
  photoMissing: { fontSize: 13, color: BitcoinColors.red },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  checkDot: { marginTop: 7, marginRight: 10 },
  checkText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#E2E8F0' },
  input: {
    backgroundColor: BitcoinColors.darkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 15,
    color: '#FFFFFF',
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  approveBtn: { backgroundColor: BitcoinColors.green },
  approveText: { fontSize: 14, fontWeight: '800', color: '#07090E' },
  rejectBtn: { backgroundColor: BitcoinColors.red },
  rejectText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  rejectOutline: { borderWidth: 1, borderColor: 'rgba(244, 63, 94, 0.5)', backgroundColor: 'rgba(244, 63, 94, 0.08)' },
  rejectOutlineText: { fontSize: 14, fontWeight: '800', color: BitcoinColors.red },
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});

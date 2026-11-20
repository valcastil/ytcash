import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { BitcoinColors } from '@/constants/theme';
import { pickAvatarFrom, saveUserAvatar } from '@/services/avatar';

interface AvatarPickerModalProps {
  visible: boolean;
  userId: string | null;
  hasAvatar: boolean;
  onClose: () => void;
  onUpdated: (newUri: string | null) => Promise<void> | void;
  onOpenProfile?: () => void;
}

export function AvatarPickerModal({
  visible,
  userId,
  hasAvatar,
  onClose,
  onUpdated,
  onOpenProfile,
}: AvatarPickerModalProps) {
  const [busy, setBusy] = useState(false);

  async function handlePick(source: 'library' | 'camera') {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const uri = await pickAvatarFrom(userId, source);
      if (uri) {
        await onUpdated(uri);
        onClose();
      }
    } catch (e: any) {
      Alert.alert('Could Not Update Photo', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await saveUserAvatar(userId, null);
      await onUpdated(null);
      onClose();
    } catch (e: any) {
      Alert.alert('Could Not Remove Photo', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {hasAvatar ? 'Profile Photo & Account' : 'Add Profile Photo'}
          </Text>
          <Text style={styles.subtitle}>
            Choose a photo for your YTCash wallet avatar.
          </Text>

          {busy ? (
            <View style={styles.busyWrap}>
              <ActivityIndicator size="small" color={BitcoinColors.orange} />
              <Text style={styles.busyText}>Updating profile photo...</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => handlePick('library')}
                activeOpacity={0.8}>
                <Ionicons name="images-outline" size={20} color={BitcoinColors.orange} />
                <Text style={styles.optionText}>Choose from Photo Library</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optionBtn}
                onPress={() => handlePick('camera')}
                activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={20} color={BitcoinColors.orange} />
                <Text style={styles.optionText}>Take Selfie / Photo</Text>
              </TouchableOpacity>

              {hasAvatar && (
                <TouchableOpacity
                  style={[styles.optionBtn, styles.dangerBtn]}
                  onPress={handleRemove}
                  activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={20} color={BitcoinColors.red} />
                  <Text style={[styles.optionText, { color: BitcoinColors.red }]}>
                    Remove Profile Photo
                  </Text>
                </TouchableOpacity>
              )}

              {onOpenProfile && (
                <TouchableOpacity
                  style={styles.optionBtn}
                  onPress={() => {
                    onClose();
                    onOpenProfile();
                  }}
                  activeOpacity={0.8}>
                  <Ionicons name="person-circle-outline" size={20} color={BitcoinColors.gold} />
                  <Text style={[styles.optionText, { color: BitcoinColors.gold }]}>
                    Account & Security (Profile)
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            disabled={busy}
            activeOpacity={0.8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    backgroundColor: BitcoinColors.cardBg,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: BitcoinColors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  busyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  busyText: {
    fontSize: 13,
    fontWeight: '700',
    color: BitcoinColors.textSecondary,
  },
  actions: {
    gap: 10,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: BitcoinColors.cardElevated,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  dangerBtn: {
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: BitcoinColors.border,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '800',
    color: BitcoinColors.textSecondary,
  },
});

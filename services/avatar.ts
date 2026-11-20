import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Alert, type AlertButton } from 'react-native';

import { withAppLockSuspended } from '@/services/biometrics';
import { supabase } from '@/services/supabase';

const AVATAR_CACHE_PREFIX = 'ytcash.avatar.';

export async function getCachedAvatar(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${AVATAR_CACHE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

export async function saveUserAvatar(userId: string, dataUri: string | null): Promise<void> {
  if (dataUri) {
    await AsyncStorage.setItem(`${AVATAR_CACHE_PREFIX}${userId}`, dataUri).catch(() => {});
  } else {
    await AsyncStorage.removeItem(`${AVATAR_CACHE_PREFIX}${userId}`).catch(() => {});
  }

  const { error } = await supabase
    .from('users')
    .update({ avatar_url: dataUri })
    .eq('id', userId);

  if (error) {
    throw error;
  }
}

export async function pickAvatarFrom(
  userId: string,
  source: 'library' | 'camera',
): Promise<string | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!perm.granted) {
    Alert.alert(
      'Permission Needed',
      source === 'camera'
        ? 'Allow camera access to take a profile photo.'
        : 'Allow photo library access to choose a profile photo.',
    );
    return null;
  }

  const result = await withAppLockSuspended(() =>
    source === 'camera'
      ? ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.35,
          base64: true,
        })
      : ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.35,
          base64: true,
        }),
  );

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  const dataUri = asset.base64
    ? `data:image/jpeg;base64,${asset.base64}`
    : asset.uri;

  await saveUserAvatar(userId, dataUri);
  return dataUri;
}

export function showAvatarActionMenu(options: {
  userId: string;
  hasAvatar: boolean;
  onUpdated: (newUri: string | null) => void;
  onOpenProfile?: () => void;
}) {
  const { userId, hasAvatar, onUpdated, onOpenProfile } = options;

  const buttons: AlertButton[] = [
    {
      text: 'Choose from Photo Library',
      onPress: async () => {
        try {
          const uri = await pickAvatarFrom(userId, 'library');
          if (uri) onUpdated(uri);
        } catch (e: any) {
          Alert.alert('Could Not Update Photo', e?.message ?? 'Please try again.');
        }
      },
    },
    {
      text: 'Take Selfie / Photo',
      onPress: async () => {
        try {
          const uri = await pickAvatarFrom(userId, 'camera');
          if (uri) onUpdated(uri);
        } catch (e: any) {
          Alert.alert('Could Not Update Photo', e?.message ?? 'Please try again.');
        }
      },
    },
  ];

  if (hasAvatar) {
    buttons.push({
      text: 'Remove Profile Photo',
      style: 'destructive',
      onPress: async () => {
        try {
          await saveUserAvatar(userId, null);
          onUpdated(null);
        } catch (e: any) {
          Alert.alert('Could Not Remove Photo', e?.message ?? 'Please try again.');
        }
      },
    });
  }

  if (onOpenProfile) {
    buttons.push({
      text: 'Account & Security (Profile)',
      onPress: onOpenProfile,
    });
  }

  buttons.push({ text: 'Cancel', style: 'cancel' });

  Alert.alert(
    hasAvatar ? 'Profile Photo & Account' : 'Add Profile Photo',
    'Set a custom avatar for your YTCash wallet.',
    buttons,
  );
}

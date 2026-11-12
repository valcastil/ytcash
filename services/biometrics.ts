import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

// ─── Fingerprint / Face ID lock ─────────────────────────
// Phones never give an app the fingerprint or face itself. The operating system
// compares it with what is enrolled on the device and tells the app yes or no.
//
// The lock does two things on this device:
//   1. unlocks the app when it is opened or brought back from the background
//   2. confirms each action that sends or receives money
//
// It is on by default whenever the phone has a fingerprint or face set up, and it
// protects a phone that is unlocked or borrowed. It is a device-side check; the
// rules about who may move money are enforced separately on the server.

export interface BiometricSupport {
  /** The device has a fingerprint or face sensor. */
  available: boolean;
  /** At least one fingerprint or face is set up on the device. */
  enrolled: boolean;
  /** What to call it on this device, e.g. "Fingerprint" or "Face ID". */
  label: string;
}

/** How long the app may sit in the background before it locks again. */
export const APP_LOCK_GRACE_MS = 30_000;

const lockKey = (userId: string) => `ytcash.biometricLock.${userId}`;

export async function getBiometricSupport(): Promise<BiometricSupport> {
  try {
    const [available, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const hasFinger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const label = hasFinger && hasFace ? 'Fingerprint or face' : hasFace ? 'Face ID' : 'Fingerprint';
    return { available, enrolled, label };
  } catch {
    return { available: false, enrolled: false, label: 'Fingerprint' };
  }
}

/** The user's choice. On unless they turned it off. */
export async function isBiometricLockEnabled(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(lockKey(userId)).catch(() => null)) !== '0';
}

/**
 * True when the lock should actually be applied: the user has it on and the phone
 * has a fingerprint or face enrolled. Without an enrolled biometric there is
 * nothing reliable to ask for, so the lock stays out of the way rather than
 * risk shutting the owner out.
 */
export async function isBiometricLockActive(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !(await isBiometricLockEnabled(userId))) return false;
  const support = await getBiometricSupport();
  return support.available && support.enrolled;
}

// ─── Pausing the app lock ───────────────────────────────
// Taking a photo or running the ID scan sends the app to the background for a
// while. That is not the user leaving, so the app lock is paused around it.

let suspendCount = 0;

export function isAppLockSuspended(): boolean {
  return suspendCount > 0;
}

export async function withAppLockSuspended<T>(action: () => Promise<T>): Promise<T> {
  suspendCount++;
  try {
    return await action();
  } finally {
    // Let the app settle back into the foreground before the lock watches again.
    setTimeout(() => {
      suspendCount = Math.max(0, suspendCount - 1);
    }, 1000);
  }
}

// ─── Asking ─────────────────────────────────────────────

export async function authenticate(promptMessage: string): Promise<boolean> {
  return withAppLockSuspended(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel: 'Cancel',
        // Allows the device PIN or pattern if the sensor fails repeatedly.
        disableDeviceFallback: false,
      });
      return result.success;
    } catch {
      return false;
    }
  });
}

/** Turning the lock on or off itself requires a successful check. Returns the new state. */
export async function setBiometricLock(userId: string, enabled: boolean): Promise<boolean> {
  const ok = await authenticate(enabled ? 'Confirm to turn on the app lock' : 'Confirm to turn off the app lock');
  if (!ok) return !enabled;
  await AsyncStorage.setItem(lockKey(userId), enabled ? '1' : '0');
  return enabled;
}

/**
 * Call before sending or receiving money. Resolves true when the lock does not
 * apply on this device, or when the person passes the fingerprint / face check.
 */
export async function confirmWithBiometrics(userId: string | null | undefined, reason: string): Promise<boolean> {
  if (!(await isBiometricLockActive(userId))) return true;
  return authenticate(reason);
}

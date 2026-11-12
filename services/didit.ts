import * as WebBrowser from 'expo-web-browser';

export type DiditOutcome =
  | { type: 'completed' }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string };

/** Where Didit's hosted page sends the user when it is finished (see KYC_CALLBACK_URL). */
const CALLBACK_URL = 'ytcash://kyc';

const ERROR_MESSAGES: Record<string, string> = {
  sessionExpired: 'This verification session expired. Start again.',
  networkError: 'The connection dropped during verification. Check your internet and try again.',
  cameraAccessDenied: 'Camera access is needed to scan your ID and face. Allow it in Settings and try again.',
  retryBlocked: 'Too many attempts. Please try again later.',
};

/**
 * Runs Didit's ID + face verification for a session created by our server.
 *
 * Uses Didit's native SDK when the app build includes it. In builds without it
 * (for example Expo Go), the same session opens in the system browser instead.
 * Either way the result shown here is only a hint: the decision that counts
 * reaches our server directly from Didit.
 */
export async function launchDidit(sessionToken: string, url: string): Promise<DiditOutcome> {
  let sdk: typeof import('@didit-protocol/sdk-react-native') | null = null;
  try {
    // Loaded lazily: importing it at the top would crash builds that lack the native module.
    sdk = require('@didit-protocol/sdk-react-native');
  } catch {
    sdk = null;
  }

  if (sdk) {
    try {
      const result = await sdk.startVerification(sessionToken, {
        showCloseButton: true,
        showExitConfirmation: true,
      });
      if (result.type === 'completed') return { type: 'completed' };
      if (result.type === 'cancelled') return { type: 'cancelled' };
      return {
        type: 'failed',
        message: ERROR_MESSAGES[result.error.type] ?? 'Verification could not be completed. Please try again.',
      };
    } catch {
      // Fall through to the browser flow.
    }
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(url, CALLBACK_URL);
    return result.type === 'success' ? { type: 'completed' } : { type: 'cancelled' };
  } catch {
    return { type: 'failed', message: 'Could not open the verification page. Please try again.' };
  }
}

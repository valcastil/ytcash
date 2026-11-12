import * as WebBrowser from 'expo-web-browser';

export type DiditOutcome =
  | { type: 'completed' }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string };

/** On the web the hosted Didit page opens in a new tab; the user returns and checks status. */
export async function launchDidit(_sessionToken: string, url: string): Promise<DiditOutcome> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return { type: 'completed' };
  } catch {
    return { type: 'failed', message: 'Could not open the verification page. Please try again.' };
  }
}

import * as Location from 'expo-location';

import { roundCoords, type Coords } from '@/services/presence';

export type LocationResult =
  | { status: 'granted'; coords: Coords }
  | { status: 'denied' | 'blocked' | 'unavailable' };

/**
 * Reads this device's location, rounded to about 1 km, if permission was already given.
 * The app never handles a more precise position than this.
 */
export async function readRoundedLocation(): Promise<Coords | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // A recent cached fix is plenty for a ~1 km area and avoids waking the GPS.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(
      () => null,
    );
    const position =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));

    return roundCoords(position.coords.latitude, position.coords.longitude);
  } catch (e) {
    console.warn('Could not read location:', e);
    return null;
  }
}

/** Asks for location permission if needed, then reads the rounded location. */
export async function requestRoundedLocation(): Promise<LocationResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return { status: permission.canAskAgain ? 'denied' : 'blocked' };
    }
    const coords = await readRoundedLocation();
    return coords ? { status: 'granted', coords } : { status: 'unavailable' };
  } catch (e) {
    console.warn('Location request failed:', e);
    return { status: 'unavailable' };
  }
}

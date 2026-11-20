import * as Location from 'expo-location';

import { roundCoords, type Coords } from '@/services/presence';

export type LocationResult =
  | { status: 'granted'; coords: Coords }
  | { status: 'denied' | 'blocked' | 'unavailable' };

/**
 * Reads this device's exact GPS coordinates (no rounding) using high accuracy.
 * Ideal for centering the map on the user's own precise location.
 */
export async function readPreciseLocation(): Promise<Coords | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
    if (!servicesEnabled) return null;

    const position =
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).catch(
        () => null,
      )) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(
        () => null,
      )) ??
      (await Location.getLastKnownPositionAsync({ maxAge: 60 * 1000 }).catch(() => null));

    if (!position) return null;
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch {
    return null;
  }
}

/** Asks for location permission if needed, then reads exact GPS coordinates. */
export async function requestPreciseLocation(): Promise<LocationResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return { status: permission.canAskAgain ? 'denied' : 'blocked' };
    }
    const coords = await readPreciseLocation();
    return coords ? { status: 'granted', coords } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Reads this device's location with balanced/high accuracy, rounded to LOCATION_DECIMALS.
 */
export async function readRoundedLocation(): Promise<Coords | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
    if (!servicesEnabled) return null;

    const position =
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(
        () => null,
      )) ??
      (await Location.getLastKnownPositionAsync({ maxAge: 60 * 1000 }).catch(() => null));

    if (!position) return null;

    return roundCoords(position.coords.latitude, position.coords.longitude);
  } catch {
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
  } catch {
    return { status: 'unavailable' };
  }
}

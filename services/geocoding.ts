import { Platform } from 'react-native';

// ─── Address lookup ─────────────────────────────────────
// Turns a typed address into coordinates so the nearest cash partner can be found.
// Defaults to OpenStreetMap's Nominatim, which is free but limited to light use
// (about 1 request per second, no autocomplete). It is only called when the user
// taps "Find address". For production traffic, point EXPO_PUBLIC_GEOCODER_URL at a
// hosted Nominatim-compatible service.

const GEOCODER_URL =
  process.env.EXPO_PUBLIC_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';

/** ISO country code(s) the receiver's address must be in. */
const GEOCODER_COUNTRIES = process.env.EXPO_PUBLIC_P2P_COUNTRY || 'ph';

export interface AddressMatch {
  label: string;
  lat: number;
  lng: number;
}

export async function searchAddress(query: string): Promise<AddressMatch[]> {
  const q = query.trim();
  if (q.length < 5) return [];

  const url =
    `${GEOCODER_URL}?format=jsonv2&limit=5&addressdetails=0` +
    `&countrycodes=${encodeURIComponent(GEOCODER_COUNTRIES)}&q=${encodeURIComponent(q)}`;

  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'en' };
  // Nominatim asks apps to identify themselves; browsers do this with the Referer instead.
  if (Platform.OS !== 'web') headers['User-Agent'] = 'YTCash/1.0 (com.ytcash.app)';

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('Address search is unavailable right now. Try again shortly.');

  const results: unknown = await response.json();
  if (!Array.isArray(results)) return [];

  const matches: AddressMatch[] = [];
  for (const item of results) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    const label = typeof item?.display_name === 'string' ? item.display_name : '';
    if (label && Number.isFinite(lat) && Number.isFinite(lng)) matches.push({ label, lat, lng });
  }
  return matches;
}

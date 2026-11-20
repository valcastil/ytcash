import { Platform } from 'react-native';

// ─── Address lookup ─────────────────────────────────────
// Uses Google Geocoding API when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set,
// and falls back to OpenStreetMap's Nominatim when no key is configured.

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const GEOCODER_URL =
  process.env.EXPO_PUBLIC_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';

/** Optional ISO country code(s) for Nominatim fallback. */
const GEOCODER_COUNTRIES = process.env.EXPO_PUBLIC_P2P_COUNTRY || '';

export interface AddressMatch {
  label: string;
  lat: number;
  lng: number;
}

async function searchWithGoogle(query: string): Promise<AddressMatch[]> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const json: any = await response.json();
  if (json?.status !== 'OK' || !Array.isArray(json.results)) return [];

  const matches: AddressMatch[] = [];
  for (const item of json.results.slice(0, 5)) {
    const lat = Number(item?.geometry?.location?.lat);
    const lng = Number(item?.geometry?.location?.lng);
    const label = typeof item?.formatted_address === 'string' ? item.formatted_address : '';
    if (label && Number.isFinite(lat) && Number.isFinite(lng)) {
      matches.push({ label, lat, lng });
    }
  }
  return matches;
}

/** Searches an address using Google Geocoding API (if configured) or Nominatim. */
export async function searchAddress(
  query: string,
  countries: string = GEOCODER_COUNTRIES,
): Promise<AddressMatch[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  if (GOOGLE_MAPS_API_KEY) {
    try {
      const googleMatches = await searchWithGoogle(q);
      if (googleMatches.length > 0) return googleMatches;
    } catch {
      // Fall through to Nominatim if Google Geocoding fails or is restricted.
    }
  }

  const countryParam = countries ? `&countrycodes=${encodeURIComponent(countries)}` : '';
  const url =
    `${GEOCODER_URL}?format=jsonv2&limit=5&addressdetails=0` +
    `${countryParam}&q=${encodeURIComponent(q)}`;

  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'en' };
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
